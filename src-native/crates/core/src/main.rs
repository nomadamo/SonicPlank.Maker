mod capture;
mod capture_mf;
mod d2d;
mod sources;
mod streaming;

use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use anyhow::{anyhow, Context, Result};
use sonicplank_ipc::{
    decode_command, encode_event, CaptureSource, Command, ErrorCode, Event, PROTOCOL_VERSION,
};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::windows::named_pipe::ServerOptions;
use tokio::sync::broadcast;
use tracing::{error, info, warn};

use capture::{RawFrame, SharedOverlay};
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

    // Broadcast channel for raw frames: WGC  preview pipe and/or encoder.
    // Capacity 4: if a subscriber falls behind, old frames are dropped rather
    // than backing up the WGC callback.
    let (frame_tx, _) = broadcast::channel::<Arc<RawFrame>>(4);

    // Preview gate - only set when Electron has sent EnablePreview.
    let preview_enabled = Arc::new(AtomicBool::new(false));

    // Channel for events produced by the stream encoder thread  stdout.
    let (stream_evt_tx, stream_evt_rx) =
        tokio::sync::mpsc::unbounded_channel::<StreamEvent>();

    // Shared slot for overlay BGRA frames received from the offscreen BrowserWindow.
    // `run_data_pipe` writes here; `capture::process_frame` reads and uploads to D2D.
    let shared_overlay: SharedOverlay = Arc::new(Mutex::new(None));

    tokio::select! {
        result = run_stdin_commands(frame_tx.clone(), Arc::clone(&preview_enabled), stream_evt_tx, stream_evt_rx, Arc::clone(&shared_overlay)) => {
            if let Err(e) = result {
                error!("Control plane error: {e:#}");
                std::process::exit(1);
            }
        }
        result = run_data_pipe(data_pipe, token, frame_tx.subscribe(), preview_enabled, shared_overlay) => {
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

// ── Control plane (stdin  stdout) ───────────────────────────────────────────

async fn run_stdin_commands(
    frame_tx: broadcast::Sender<Arc<RawFrame>>,
    preview_enabled: Arc<AtomicBool>,
    stream_evt_tx: tokio::sync::mpsc::UnboundedSender<StreamEvent>,
    mut stream_evt_rx: tokio::sync::mpsc::UnboundedReceiver<StreamEvent>,
    shared_overlay: SharedOverlay,
) -> Result<()> {
    let mut stdin = BufReader::new(tokio::io::stdin());
    let mut stdout = tokio::io::stdout();
    let mut line = String::new();
    let mut active_sessions: std::collections::HashMap<String, Box<dyn CaptureSessionTrait>> = std::collections::HashMap::new();
    let mut active_stream: Option<StreamSession> = None;

    loop {
        line.clear();
        tokio::select! {
            // ── Stream events from the encoder thread  stdout ────────────────
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
                        std::process::exit(0);
                    }
                    Err(e) => {
                        error!("stdin read error: {e}");
                        std::process::exit(1);
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
                        std::process::exit(0);
                    }
                    Ok(Command::GetSources) => {
                        let items: Vec<CaptureSource> = sources::enumerate();
                        let frame = encode_event(&Event::Sources { items })?;
                        stdout.write_all(&frame).await?;
                        stdout.flush().await?;
                    }
                    Ok(Command::StartCapture { source_id, overlay_hwnd }) => {
                        let session_result: Result<Box<dyn CaptureSessionTrait>> = if source_id.starts_with("webcam:") {
                            let sym_link = source_id.trim_start_matches("webcam:");
                            capture_mf::MFCaptureSession::new(source_id.clone(), sym_link, frame_tx.clone())
                                .map(|s| Box::new(s) as Box<dyn CaptureSessionTrait>)
                        } else {
                            sources::capture_item_for_id(&source_id)
                                .map_err(Into::into)
                                .and_then(|item| {
                                    let _ = overlay_hwnd; // no longer used; overlay arrives via data pipe
                                    capture::CaptureSession::new(source_id.clone(), item, frame_tx.clone(), Arc::clone(&shared_overlay))
                                        .map(|s| Box::new(s) as Box<dyn CaptureSessionTrait>)
                                })
                        };

                        match session_result {
                            Ok(session) => {
                                active_sessions.insert(source_id.clone(), session);
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
                    Ok(Command::StopCapture { source_id }) => {
                        if let Some(mut session) = active_sessions.remove(&source_id) {
                            if let Err(e) = session.stop() {
                                warn!("Failed to stop capture {source_id}: {e}");
                            }
                        }
                        if active_sessions.is_empty() {
                            preview_enabled.store(false, Ordering::Relaxed);
                        }
                        let frame = encode_event(&Event::CaptureStopped)?;
                        stdout.write_all(&frame).await?;
                        stdout.flush().await?;
                        info!("Capture stopped: {source_id}");
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
                        sources,
                    }) => {
                        if active_sessions.is_empty() {
                            let frame = encode_event(&Event::Error {
                                code: ErrorCode::EncoderError,
                                message: "StartStream requires at least one active capture session".into(),
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
                                sources,
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
    for (_, mut session) in active_sessions {
        let _ = session.stop();
    }

    Ok(())
}

// ── Data pipe (preview-only frame transport) ──────────────────────────────────

/// Accept one connection, verify Hello, then:
/// - Spawn a reader task that pulls type-2 overlay frames from JS and stores them
///   in `shared_overlay` for `process_frame` to pick up.
/// - Forward serialized preview frames (type 1) to Electron while `preview_enabled` is set.
async fn run_data_pipe(
    server: tokio::net::windows::named_pipe::NamedPipeServer,
    expected_token: String,
    mut frame_rx: broadcast::Receiver<Arc<RawFrame>>,
    preview_enabled: Arc<AtomicBool>,
    shared_overlay: SharedOverlay,
) -> Result<()> {
    server.connect().await.context("Data pipe accept failed")?;
    info!("Data pipe client connected");

    let (reader, mut writer) = tokio::io::split(server);
    let mut buf_reader = BufReader::new(reader);

    // Read the Hello authentication line.
    let mut first_line = String::new();
    let bytes_read = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        buf_reader.read_line(&mut first_line),
    )
    .await
    .map_err(|_| anyhow!("Timed out waiting for Hello on data pipe"))?
    .context("Data pipe read error")?;

    if bytes_read == 0 {
        return Err(anyhow!("Data pipe closed before Hello was received"));
    }

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

    // Spawn a task that reads incoming overlay frames from Electron.
    // Format: [u8 type=2][u32 width LE][u32 height LE][BGRA pixels]
    tokio::spawn(async move {
        loop {
            let mut type_byte = [0u8; 1];
            if buf_reader.read_exact(&mut type_byte).await.is_err() {
                break;
            }
            if type_byte[0] != 2 {
                tracing::warn!("Unexpected byte on data pipe from Electron: {}", type_byte[0]);
                break;
            }
            let mut dims = [0u8; 8];
            if buf_reader.read_exact(&mut dims).await.is_err() {
                break;
            }
            let width  = u32::from_le_bytes([dims[0], dims[1], dims[2], dims[3]]);
            let height = u32::from_le_bytes([dims[4], dims[5], dims[6], dims[7]]);
            let pixel_count = (width as usize).saturating_mul(height as usize).saturating_mul(4);
            if pixel_count == 0 || pixel_count > 64 * 1024 * 1024 {
                tracing::warn!("Overlay frame size out of range: {width}×{height}");
                break;
            }
            let mut pixels = vec![0u8; pixel_count];
            if buf_reader.read_exact(&mut pixels).await.is_err() {
                break;
            }
            *shared_overlay.lock().unwrap() = Some((pixels, width, height));
        }
    });

    info!("Data pipe ready -> waiting for preview to be enabled");

    let mut last_preview_time = tokio::time::Instant::now();
    let preview_interval = std::time::Duration::from_millis(66); // ~15 FPS

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

        if last_preview_time.elapsed() < preview_interval {
            continue;
        }
        last_preview_time = tokio::time::Instant::now();

        let scale = 3;
        let scaled_w = raw.width / scale;
        let scaled_h = raw.height / scale;
        let mut scaled_pixels = Vec::with_capacity((scaled_w * scaled_h * 4) as usize);

        for y in 0..scaled_h {
            for x in 0..scaled_w {
                let src_idx = ((y * scale * raw.width + x * scale) * 4) as usize;
                let b = raw.pixels[src_idx];
                let g = raw.pixels[src_idx + 1];
                let r = raw.pixels[src_idx + 2];
                let a = raw.pixels[src_idx + 3];
                scaled_pixels.push(r); // R
                scaled_pixels.push(g); // G
                scaled_pixels.push(b); // B
                scaled_pixels.push(a); // A
            }
        }

        // Serialize: FrameHeader(8) + u8 source_id_len + [source_id_bytes] + u32 width + u32 height + BGRA pixels.
        let source_id_bytes = raw.source_id.as_bytes();
        let source_id_len = source_id_bytes.len() as u8;
        let payload_len = 1 + source_id_len as u32 + 8 + scaled_pixels.len() as u32;
        let mut frame_bytes =
            Vec::with_capacity(8 + payload_len as usize);
        frame_bytes.extend_from_slice(&sonicplank_ipc::encode_frame_header(
            &sonicplank_ipc::FrameHeader {
                frame_type: sonicplank_ipc::FrameType::VideoPreview,
                payload_len,
            },
        ));
        frame_bytes.push(source_id_len);
        frame_bytes.extend_from_slice(source_id_bytes);
        frame_bytes.extend_from_slice(&scaled_w.to_le_bytes());
        frame_bytes.extend_from_slice(&scaled_h.to_le_bytes());
        frame_bytes.extend_from_slice(&scaled_pixels);

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

pub trait CaptureSessionTrait: Send + Sync {
    fn stop(&mut self) -> anyhow::Result<()>;
}

impl CaptureSessionTrait for capture::CaptureSession {
    fn stop(&mut self) -> anyhow::Result<()> {
        capture::CaptureSession::stop(self)
    }
}

impl CaptureSessionTrait for capture_mf::MFCaptureSession {
    fn stop(&mut self) -> anyhow::Result<()> {
        capture_mf::MFCaptureSession::stop(self)
    }
}
