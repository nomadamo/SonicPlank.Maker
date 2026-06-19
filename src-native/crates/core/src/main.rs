mod capture;
mod sources;
mod streaming;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};

use anyhow::{anyhow, Context, Result};
use sonicplank_ipc::{
    decode_command, encode_event, CaptureSource, Command, ErrorCode, Event, PROTOCOL_VERSION,
};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::ServerOptions;
use tokio::sync::broadcast;
use tracing::{error, info, warn};

use capture::RawFrame;
use streaming::{StreamEvent, StreamOptions, StreamSession};

// ── Startup ───────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_target(false)
        .with_writer(std::io::stderr)
        .init();

    info!(
        version = env!("CARGO_PKG_VERSION"),
        "SonicPlank Core starting"
    );

    streaming::start_config_watcher();

    let (token, pipe_name) =
        read_auth_from_stdin().await.context("Auth handshake failed")?;

    let data_pipe = ServerOptions::new()
        .first_pipe_instance(true)
        .create(&pipe_name)
        .with_context(|| format!("Failed to create data pipe: {pipe_name}"))?;

    info!(pipe = %pipe_name, "Data pipe bound");

    println!(
        "{}",
        serde_json::to_string(&Event::Ready {
            version: PROTOCOL_VERSION,
            pid: std::process::id(),
            pipe: pipe_name.clone(),
        })?
    );

    // Broadcast channel for raw frames: WGC → preview pipe and/or encoder.
    // Capacity 4: if a subscriber falls behind, old frames are dropped rather
    // than backing up the WGC callback.
    let (frame_tx, _) = broadcast::channel::<Arc<RawFrame>>(4);

    // Preview gate — only set when Electron has sent EnablePreview.
    let preview_enabled = Arc::new(AtomicBool::new(false));

    // Channel for events produced by the stream encoder thread → stdout.
    let (stream_evt_tx, stream_evt_rx) =
        tokio::sync::mpsc::unbounded_channel::<StreamEvent>();

    tokio::select! {
        result = run_stdin_commands(frame_tx.clone(), Arc::clone(&preview_enabled), stream_evt_tx, stream_evt_rx) => {
            if let Err(e) = result {
                error!("Control plane error: {e:#}");
                std::process::exit(1);
            }
        }
        result = run_data_pipe(data_pipe, token, frame_tx.subscribe(), preview_enabled) => {
            if let Err(e) = result {
                error!("Data pipe error: {e:#}");
            }
        }
        _ = tokio::signal::ctrl_c() => {
            info!("Ctrl-C received");
        }
    }

    info!("SonicPlank Core exiting");
    Ok(())
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async fn read_auth_from_stdin() -> Result<(String, String)> {
    let mut stdin = BufReader::new(tokio::io::stdin());
    let mut line = String::new();

    let read = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        stdin.read_line(&mut line),
    )
    .await
    .map_err(|_| anyhow!("Timed out waiting for Auth on stdin"))?
    .context("Failed to read Auth line from stdin")?;

    if read == 0 {
        return Err(anyhow!("stdin closed before Auth was received"));
    }

    match decode_command(line.trim()).context("Failed to decode Auth command")? {
        Command::Auth { token, pipe_id } => {
            if token.is_empty() || pipe_id.is_empty() {
                return Err(anyhow!("Auth token or pipe_id is empty"));
            }
            let pipe_name = format!(r"\\.\pipe\sonicplank-{pipe_id}");
            info!(pipe = %pipe_name, "Auth received");
            Ok((token, pipe_name))
        }
        other => Err(anyhow!(
            "Expected Auth as first stdin message, got: {other:?}"
        )),
    }
}

// ── Control plane (stdin → stdout) ───────────────────────────────────────────

async fn run_stdin_commands(
    frame_tx: broadcast::Sender<Arc<RawFrame>>,
    preview_enabled: Arc<AtomicBool>,
    stream_evt_tx: tokio::sync::mpsc::UnboundedSender<StreamEvent>,
    mut stream_evt_rx: tokio::sync::mpsc::UnboundedReceiver<StreamEvent>,
) -> Result<()> {
    let mut stdin = BufReader::new(tokio::io::stdin());
    let mut stdout = tokio::io::stdout();
    let mut line = String::new();
    let mut active_session: Option<capture::CaptureSession> = None;
    let mut active_stream: Option<StreamSession> = None;

    loop {
        line.clear();
        tokio::select! {
            // ── Stream events from the encoder thread → stdout ────────────────
            Some(evt) = stream_evt_rx.recv() => {
                match evt {
                    StreamEvent::Started { width, height } => {
                        let frame = encode_event(&Event::StreamStarted { width, height })?;
                        stdout.write_all(&frame).await?;
                        stdout.flush().await?;
                    }
                    StreamEvent::Status { frame, fps, bitrate_kbps } => {
                        let ev = encode_event(&Event::StreamStatus { frame, fps, bitrate_kbps, dropped: 0 })?;
                        stdout.write_all(&ev).await?;
                        stdout.flush().await?;
                    }
                    StreamEvent::Error(msg) => {
                        let frame = encode_event(&Event::Error {
                            code: ErrorCode::EncoderError,
                            message: msg,
                        })?;
                        stdout.write_all(&frame).await?;
                        stdout.flush().await?;
                    }
                    StreamEvent::Stopped => {
                        active_stream = None;
                        let frame = encode_event(&Event::StreamStopped)?;
                        stdout.write_all(&frame).await?;
                        stdout.flush().await?;
                    }
                }
                continue;
            }
            // ── Commands from Electron on stdin ───────────────────────────────
            read_result = stdin.read_line(&mut line) => {
                match read_result {
                    Ok(0) => {
                        info!("stdin closed - Electron exited");
                        break;
                    }
                    Err(e) => {
                        error!("stdin read error: {e}");
                        break;
                    }
                    Ok(_) => {}
                }
            }
        }

        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match decode_command(trimmed) {
                    Ok(Command::Ping) => {
                        let frame = encode_event(&Event::Pong {
                            version: PROTOCOL_VERSION,
                        })?;
                        stdout.write_all(&frame).await?;
                        stdout.flush().await?;
                    }
                    Ok(Command::Shutdown) => {
                        info!("Shutdown command received");
                        break;
                    }
                    Ok(Command::GetSources) => {
                        let items: Vec<CaptureSource> = sources::enumerate();
                        let frame = encode_event(&Event::Sources { items })?;
                        stdout.write_all(&frame).await?;
                        stdout.flush().await?;
                    }
                    Ok(Command::StartCapture { source_id }) => {
                        if let Some(prev) = active_session.take() {
                            if let Err(e) = prev.stop() {
                                warn!("Failed to stop previous capture: {e}");
                            }
                        }

                        match sources::capture_item_for_id(&source_id) {
                            Ok(item) => {
                                match capture::CaptureSession::new(item, frame_tx.clone()) {
                                    Ok(session) => {
                                        active_session = Some(session);
                                        let frame = encode_event(&Event::CaptureStarted {
                                            source_id: source_id.clone(),
                                        })?;
                                        stdout.write_all(&frame).await?;
                                        stdout.flush().await?;
                                        info!(source = %source_id, "Capture started");
                                    }
                                    Err(e) => {
                                        warn!("Failed to start capture for {source_id}: {e}");
                                        let frame = encode_event(&Event::Error {
                                            code: ErrorCode::CaptureError,
                                            message: format!("StartCapture failed: {e}"),
                                        })?;
                                        stdout.write_all(&frame).await?;
                                        stdout.flush().await?;
                                    }
                                }
                            }
                            Err(e) => {
                                warn!("Unknown source id {source_id}: {e}");
                                let frame = encode_event(&Event::Error {
                                    code: ErrorCode::Unknown,
                                    message: format!("Unknown source: {source_id}"),
                                })?;
                                stdout.write_all(&frame).await?;
                                stdout.flush().await?;
                            }
                        }
                    }
                    Ok(Command::StopCapture) => {
                        preview_enabled.store(false, Ordering::Relaxed);
                        if let Some(session) = active_session.take() {
                            if let Err(e) = session.stop() {
                                warn!("Failed to stop capture: {e}");
                            }
                        }
                        let frame = encode_event(&Event::CaptureStopped)?;
                        stdout.write_all(&frame).await?;
                        stdout.flush().await?;
                        info!("Capture stopped");
                    }
                    Ok(Command::EnablePreview) => {
                        preview_enabled.store(true, Ordering::Relaxed);
                        info!("Preview enabled");
                    }
                    Ok(Command::DisablePreview) => {
                        preview_enabled.store(false, Ordering::Relaxed);
                        info!("Preview disabled");
                    }
                    Ok(Command::StartStream {
                        rtmp_url,
                        bitrate_kbps,
                        fps,
                        output_width,
                        output_height,
                        fit_mode,
                        encoder,
                    }) => {
                        if active_session.is_none() {
                            let frame = encode_event(&Event::Error {
                                code: ErrorCode::EncoderError,
                                message: "StartStream requires an active capture session".into(),
                            })?;
                            stdout.write_all(&frame).await?;
                            stdout.flush().await?;
                        } else {
                            // Stop any previous stream first.
                            if let Some(mut s) = active_stream.take() {
                                s.stop();
                            }
                            let opts = StreamOptions {
                                rtmp_url,
                                bitrate_kbps,
                                fps,
                                output_width,
                                output_height,
                                fit_mode,
                                encoder,
                            };
                            active_stream = Some(StreamSession::start(
                                opts,
                                frame_tx.subscribe(),
                                stream_evt_tx.clone(),
                            ));
                            info!("Stream encoder started");
                        }
                    }
                    Ok(Command::StopStream) => {
                        if let Some(mut s) = active_stream.take() {
                            s.stop();
                            // StreamStopped event is emitted by the encoder thread.
                        }
                    }
                    Ok(other) => {
                        warn!("Unexpected command on control plane: {other:?}");
                        let frame = encode_event(&Event::Error {
                            code: ErrorCode::IpcError,
                            message: format!("unexpected command: {other:?}"),
                        })?;
                        stdout.write_all(&frame).await?;
                        stdout.flush().await?;
                    }
                    Err(e) => {
                        warn!("Unrecognised command: {e}");
                        let frame = encode_event(&Event::Error {
                            code: ErrorCode::IpcError,
                            message: format!("unknown command: {e}"),
                        })?;
                        stdout.write_all(&frame).await?;
                        stdout.flush().await?;
                    }
                }
    }

    if let Some(mut s) = active_stream.take() {
        s.stop();
    }
    if let Some(session) = active_session {
        let _ = session.stop();
    }

    Ok(())
}

// ── Data pipe (preview-only frame transport) ──────────────────────────────────

/// Accept one connection, verify Hello, then forward serialized preview frames
/// to Electron — but only while `preview_enabled` is set. Frames are always
/// consumed from the broadcast receiver so the channel never backs up.
async fn run_data_pipe(
    server: tokio::net::windows::named_pipe::NamedPipeServer,
    expected_token: String,
    mut frame_rx: broadcast::Receiver<Arc<RawFrame>>,
    preview_enabled: Arc<AtomicBool>,
) -> Result<()> {
    server.connect().await.context("Data pipe accept failed")?;
    info!("Data pipe client connected");

    let (reader, mut writer) = tokio::io::split(server);
    let mut lines = BufReader::new(reader).lines();

    let first_line = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        lines.next_line(),
    )
    .await
    .map_err(|_| anyhow!("Timed out waiting for Hello on data pipe"))?
    .context("Data pipe read error")?
    .ok_or_else(|| anyhow!("Data pipe closed before Hello was received"))?;

    match decode_command(first_line.trim()) {
        Ok(Command::Hello { token }) => {
            if !tokens_equal(token.as_bytes(), expected_token.as_bytes()) {
                return Err(anyhow!("Data pipe Hello token mismatch - closing"));
            }
            info!("Data pipe authenticated");
        }
        Ok(other) => {
            return Err(anyhow!(
                "Expected Hello as first data pipe message, got: {other:?}"
            ));
        }
        Err(e) => {
            return Err(anyhow!("Failed to decode Hello: {e}"));
        }
    }

    info!("Data pipe ready — waiting for preview to be enabled");

    loop {
        let raw = match frame_rx.recv().await {
            Ok(f) => f,
            // Lagged: broadcast dropped old frames — just skip and keep going.
            Err(broadcast::error::RecvError::Lagged(n)) => {
                warn!("Preview pipe lagged, dropped {n} frames");
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => break,
        };

        if !preview_enabled.load(Ordering::Relaxed) {
            // Capture is running (e.g. streaming-only) but preview is off.
            // Frame consumed to prevent channel back-pressure; not written to pipe.
            continue;
        }

        // Serialize: FrameHeader(8) + u32 width + u32 height + BGRA pixels.
        let payload_len = 8u32 + raw.pixels.len() as u32;
        let mut frame_bytes =
            Vec::with_capacity(8 + payload_len as usize);
        frame_bytes.extend_from_slice(&sonicplank_ipc::encode_frame_header(
            &sonicplank_ipc::FrameHeader {
                frame_type: sonicplank_ipc::FrameType::VideoPreview,
                payload_len,
            },
        ));
        frame_bytes.extend_from_slice(&raw.width.to_le_bytes());
        frame_bytes.extend_from_slice(&raw.height.to_le_bytes());
        frame_bytes.extend_from_slice(&raw.pixels);

        if let Err(e) = writer.write_all(&frame_bytes).await {
            warn!("Preview pipe write failed: {e}");
            break;
        }
    }

    Ok(())
}

/// Constant-time byte slice equality — prevents timing-based token oracle.
fn tokens_equal(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let diff = a.iter().zip(b.iter()).fold(0u8, |acc, (x, y)| acc | (x ^ y));
    diff == 0
}

// ── Tests ──────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use sonicplank_ipc::{decode_event, encode_command, Command, Event, FrameError, PROTOCOL_VERSION};

    #[test]
    fn ready_event_has_correct_version() {
        let event = Event::Ready {
            version: PROTOCOL_VERSION,
            pid: std::process::id(),
            pipe: r"\\.\pipe\sonicplank-test".into(),
        };
        match event {
            Event::Ready { version, .. } => assert_eq!(version, PROTOCOL_VERSION),
            _ => panic!("unexpected event variant"),
        }
    }

    #[test]
    fn ping_encodes_and_pong_decodes() {
        let cmd_bytes = encode_command(&Command::Ping).unwrap();
        let pong_bytes = {
            let mut b = serde_json::to_vec(&Event::Pong {
                version: PROTOCOL_VERSION,
            })
            .unwrap();
            b.push(b'\n');
            b
        };
        let line = std::str::from_utf8(&pong_bytes[..pong_bytes.len() - 1]).unwrap();
        let decoded = decode_event(line).unwrap();
        assert!(matches!(decoded, Event::Pong { .. }));
        assert!(!cmd_bytes.is_empty());
        assert_eq!(*cmd_bytes.last().unwrap(), b'\n');
    }

    #[test]
    fn tokens_equal_same() {
        assert!(tokens_equal(b"abc", b"abc"));
    }

    #[test]
    fn tokens_equal_different_content() {
        assert!(!tokens_equal(b"abc", b"abd"));
    }

    #[test]
    fn tokens_equal_different_length() {
        assert!(!tokens_equal(b"abc", b"abcd"));
    }

    #[test]
    fn tokens_equal_empty() {
        assert!(tokens_equal(b"", b""));
    }

    #[test]
    fn auth_command_encodes_correctly() {
        let cmd = Command::Auth {
            token: "tok".into(),
            pipe_id: "pipeid".into(),
        };
        let encoded = encode_command(&cmd).unwrap();
        let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
        assert!(matches!(
            decode_command(line).unwrap(),
            Command::Auth { .. }
        ));
    }

    #[test]
    fn frame_error_display() {
        let e = FrameError::UnknownFrameType(42);
        assert!(e.to_string().contains("42"));
    }
}
