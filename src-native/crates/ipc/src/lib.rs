#![forbid(unsafe_code)]
//! IPC message protocol between the Electron UI and `sonicplank-core`.
//!
//! ## Transport layers
//!
//! | Channel  | Direction          | Content                        |
//! |----------|--------------------|--------------------------------|
//! | stdin    | Electron  Core    | Auth (once), Commands, Overlay |
//! | stdout   | Core  Electron    | Ready (once), Events, Status   |
//! | data pipe| Core  Electron    | Binary video frames (Phase 1+) |
//!
//! ## Control-plane framing
//!
//! Each control message is a single JSON object followed by `\n`. The `type`
//! field is the serde tagged-enum discriminant:
//!
//! ```json
//! {"type":"auth","token":"<base64url>","pipe_id":"<hex>"}
//! {"type":"ready","version":1,"pid":1234,"pipe":"\\.\pipe\sonicplank-<hex>","shm_name":"Local\\SonicPlankOverlay-<hex>","shm_size":8294412}
//! {"type":"ping"}
//! {"type":"pong","version":1}
//! {"type":"get_sources"}
//! {"type":"sources","items":[{"id":"monitor:0","name":"Display 1","kind":"monitor"}]}
//! {"type":"start_capture","source_id":"monitor:0"}
//! {"type":"capture_started","source_id":"monitor:0"}
//! {"type":"stop_capture"}
//! {"type":"capture_stopped"}
//! ```
//!
//! ## Data-plane framing
//!
//! Each binary frame on the named pipe is preceded by an 8-byte little-endian
//! header: `[u32 frame_type][u32 payload_len]` followed by `payload_len` bytes.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Wire protocol version. Bump on any breaking change to the message schema.
pub const PROTOCOL_VERSION: u32 = 1;

// ── Commands (Electron  Core) ────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    /// First message on stdin. Carries the shared secret and the pipe-name
    /// entropy that Core uses to construct the data pipe name.
    Auth {
        /// 32-byte random value encoded as base64url. Verified again on the
        /// data pipe via [`Command::Hello`].
        token: String,
        /// 16-byte random value encoded as hex. Core constructs the pipe name
        /// as `\\.\pipe\sonicplank-{pipe_id}`.
        pipe_id: String,
    },
    /// First message on the data pipe. Core verifies it matches the token from
    /// [`Command::Auth`] before accepting the connection.
    Hello {
        token: String,
    },
    /// Liveness probe --- core must respond with [`Event::Pong`].
    Ping,
    /// Request graceful shutdown of the core process.
    Shutdown,
    /// Explicit exit command to gracefully terminate the process.
    Exit,
    /// Send configuration of sources (e.g. PiP layout).
    Config {
        sources: Vec<StreamSourceDef>,
    },
    /// Keep-alive standby message from UI.
    Standby,
    /// Request enumeration of capturable monitors and windows.
    /// Core responds with [`Event::Sources`].
    GetSources,
    /// Request enumeration of audio input and output devices.
    /// Core responds with [`Event::AudioDevices`].
    GetAudioDevices,
    /// Start capturing the requested source. Note that in Phase 1 this is just
    /// for native previews (the compositor manages its own captures based on config).
    /// Core responds with [`Event::CaptureStarted`] or [`Event::Error`].
    StartCapture {
        source_id: String,
        #[serde(default)]
        overlay_hwnd: Option<String>,
    },
    /// Core responds with [`Event::CaptureStopped`].
    StopCapture {
        source_id: String,
    },
    /// Allow the data pipe to deliver preview frames to Electron.
    /// Must be sent after [`Command::StartCapture`] for preview to appear.
    EnablePreview,
    /// Stop delivering preview frames to Electron (capture session stays live).
    DisablePreview,
    /// Begin encoding the active capture session and pushing to RTMP.
    /// Core responds with [`Event::StreamStarted`] or [`Event::Error`].
    StartStream {
        rtmp_url: String,
        bitrate_kbps: u32,
        fps: u32,
        output_width: Option<u32>,
        output_height: Option<u32>,
        fit_mode: Option<String>,
        /// Codec name: "libx264", "h264_nvenc", "h264_amf", "h264_qsv"
        encoder: String,
        sources: Vec<StreamSourceDef>,
        #[serde(default)]
        audio_device_ids: Vec<String>,
        /// If set, record the stream to this file path via stream copy (MP4).
        #[serde(default)]
        record_path: Option<String>,
    },
    /// Stop the active stream. Core responds with [`Event::StreamStopped`].
    StopStream,
    /// Request the waveform peaks for a local audio file.
    /// Core responds with [`Event::WaveformPeaks`].
    GetWaveformPeaks {
        path: String,
        pixels_per_second: u32,
    },
    /// Update the list of regions in the capture frame that the compositor
    /// should blur before compositing overlays. An empty list clears all blur.
    SetBlurRegions {
        regions: Vec<BlurRegionDef>,
    },
}

// ── Events (Core  Electron) ──────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Event {
    /// Emitted once on stdout after the data pipe is bound and ready.
    /// Electron reads this line from the child process stdout, then
    /// connects to the pipe name provided in the `pipe` field and maps
    /// the overlay shared memory section at `shm_name`.
    Ready {
        version: u32,
        pid: u32,
        /// Fully-qualified pipe name, e.g. `\\.\pipe\sonicplank-<hex>`.
        pipe: String,
        /// Name of the page-file-backed shared memory section for overlay pixels.
        /// Electron opens this with FILE_MAP_WRITE; Rust reads via seqlock.
        shm_name: String,
        /// Size of the shared memory section in bytes.
        shm_size: u32,
    },
    /// Response to [`Command::Ping`].
    Pong {
        version: u32,
    },
    /// A non-fatal error occurred inside the core.
    Error {
        code: ErrorCode,
        message: String,
    },
    /// Response to [`Command::GetSources`].
    Sources { items: Vec<CaptureSource> },
    /// Response to [`Command::GetAudioDevices`].
    AudioDevices { items: Vec<AudioDeviceDef> },
    /// Emitted when a capture session starts successfully.
    CaptureStarted { source_id: String },
    /// Emitted when the active capture session stops.
    CaptureStopped,
    /// Emitted when streaming starts successfully.
    StreamStarted {
        width: u32,
        height: u32,
    },
    /// Emitted when the stream stops (either by command or on error).
    StreamStopped,
    /// Periodic encoding statistics, emitted roughly once per second.
    StreamStatus {
        frame: u64,
        fps: f32,
        bitrate_kbps: u32,
        dropped: u64,
    },
    /// Emitted when a command like Config or Standby is received, only if --verbose flag is used.
    Acknowledge {
        command: String,
    },
    /// Response to [`Command::GetWaveformPeaks`].
    WaveformPeaks {
        path: String,
        peaks: Vec<f32>,
    },
    /// Emitted at ~100ms intervals while audio capture is active during streaming.
    /// `peak_db` is the maximum sample amplitude in the last interval, in dBFS.
    /// `f32::NEG_INFINITY` means the capture is running but produced silence.
    AudioLevel {
        peak_db: f32,
    },
}

/// A rectangular region of the captured video frame to blur before overlay compositing.
/// All coordinates are in absolute output-frame pixels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct BlurRegionDef {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    /// Gaussian-approximation blur radius in pixels at the output resolution.
    pub radius: i32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StreamSourceDef {
    pub source_id: String,
    pub is_primary: bool,
    pub x_percent: f32,
    pub y_percent: f32,
    pub w_percent: f32,
    pub h_percent: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    CaptureError,
    EncoderError,
    IpcError,
    Unknown,
}

// ── Capture source types ──────────────────────────────────────────────────────

/// A capturable display output or application window.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CaptureSource {
    /// Stable identifier used in [`Command::StartCapture`].
    /// Format: `"monitor:<index>"` or `"window:<hwnd_hex>"`.
    pub id: String,
    /// Human-readable name (monitor name or window title).
    pub name: String,
    pub kind: CaptureSourceKind,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptureSourceKind {
    Monitor,
    Window,
    Webcam,
}

/// Describes what kind of audio endpoint a device is.
///
/// - `Output`     — render endpoint (speakers/headphones); captured via WASAPI loopback.
/// - `Microphone` — physical capture endpoint (mic, headset mic).
/// - `Capture`    — software/virtual capture endpoint (VoiceMeeter Output, VB-CABLE Out, Stereo Mix).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AudioDeviceKind {
    Output,
    Microphone,
    Capture,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AudioDeviceDef {
    pub id: String,
    pub name: String,
    pub kind: AudioDeviceKind,
    pub is_default: bool,
}

// ── Data-plane binary framing ─────────────────────────────────────────────────

/// Discriminant for binary frames on the data pipe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u32)]
pub enum FrameType {
    /// Raw video frame for the preview window (Phase 1+).
    VideoPreview = 1,
}

impl TryFrom<u32> for FrameType {
    type Error = FrameError;
    fn try_from(v: u32) -> Result<Self, Self::Error> {
        match v {
            1 => Ok(FrameType::VideoPreview),
            other => Err(FrameError::UnknownFrameType(other)),
        }
    }
}

/// 8-byte little-endian header preceding every binary frame on the data pipe.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FrameHeader {
    pub frame_type: FrameType,
    /// Length of the payload that follows, in bytes.
    pub payload_len: u32,
}

/// Encode a [`FrameHeader`] into 8 little-endian bytes.
pub fn encode_frame_header(header: &FrameHeader) -> [u8; 8] {
    let mut buf = [0u8; 8];
    buf[..4].copy_from_slice(&(header.frame_type as u32).to_le_bytes());
    buf[4..].copy_from_slice(&header.payload_len.to_le_bytes());
    buf
}

/// Decode a [`FrameHeader`] from 8 little-endian bytes.
pub fn decode_frame_header(buf: &[u8; 8]) -> Result<FrameHeader, FrameError> {
    let frame_type = u32::from_le_bytes(buf[..4].try_into().unwrap());
    let payload_len = u32::from_le_bytes(buf[4..].try_into().unwrap());
    Ok(FrameHeader {
        frame_type: FrameType::try_from(frame_type)?,
        payload_len,
    })
}

// ── Control-plane framing helpers ─────────────────────────────────────────────

#[derive(Debug, Error)]
pub enum FrameError {
    #[error("serialization failed: {0}")]
    Serialize(#[from] serde_json::Error),
    #[error("unknown frame type: {0}")]
    UnknownFrameType(u32),
}

/// Encode a [`Command`] as a newline-terminated JSON frame ready to write to
/// stdin (or the data pipe for [`Command::Hello`]).
pub fn encode_command(cmd: &Command) -> Result<Vec<u8>, FrameError> {
    let mut bytes = serde_json::to_vec(cmd)?;
    bytes.push(b'\n');
    Ok(bytes)
}

/// Encode an [`Event`] as a newline-terminated JSON frame.
pub fn encode_event(event: &Event) -> Result<Vec<u8>, FrameError> {
    let mut bytes = serde_json::to_vec(event)?;
    bytes.push(b'\n');
    Ok(bytes)
}

/// Deserialize a [`Command`] from a single line (no trailing newline).
pub fn decode_command(line: &str) -> Result<Command, FrameError> {
    Ok(serde_json::from_str(line.trim())?)
}

/// Deserialize an [`Event`] from a single line (no trailing newline).
pub fn decode_event(line: &str) -> Result<Event, FrameError> {
    Ok(serde_json::from_str(line.trim())?)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // ── Round-trip tests ──────────────────────────────────────────────────────

    #[test]
    fn ping_round_trips() {
        let cmd = Command::Ping;
        let encoded = encode_command(&cmd).unwrap();
        let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
        assert_eq!(decode_command(line).unwrap(), cmd);
    }

    #[test]
    fn shutdown_round_trips() {
        let cmd = Command::Shutdown;
        let encoded = encode_command(&cmd).unwrap();
        let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
        assert_eq!(decode_command(line).unwrap(), cmd);
    }

    #[test]
    fn get_sources_round_trips() {
        let cmd = Command::GetSources;
        let encoded = encode_command(&cmd).unwrap();
        let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
        assert_eq!(decode_command(line).unwrap(), cmd);
    }

    #[test]
    fn start_capture_round_trips() {
        let cmd = Command::StartCapture { source_id: "monitor:0".into() };
        let encoded = encode_command(&cmd).unwrap();
        let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
        assert_eq!(decode_command(line).unwrap(), cmd);
    }

    #[test]
    fn stop_capture_round_trips() {
        let cmd = Command::StopCapture { source_id: "monitor:0".into() };
        let encoded = encode_command(&cmd).unwrap();
        let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
        assert_eq!(decode_command(line).unwrap(), cmd);
    }

    #[test]
    fn sources_event_round_trips() {
        let event = Event::Sources {
            items: vec![
                CaptureSource {
                    id: "monitor:0".into(),
                    name: "Display 1".into(),
                    kind: CaptureSourceKind::Monitor,
                },
                CaptureSource {
                    id: "window:0x1a2b3c4d".into(),
                    name: "Notepad".into(),
                    kind: CaptureSourceKind::Window,
                },
            ],
        };
        let encoded = encode_event(&event).unwrap();
        let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
        assert_eq!(decode_event(line).unwrap(), event);
    }

    #[test]
    fn capture_started_round_trips() {
        let event = Event::CaptureStarted { source_id: "monitor:0".into() };
        let encoded = encode_event(&event).unwrap();
        let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
        assert_eq!(decode_event(line).unwrap(), event);
    }

    #[test]
    fn capture_stopped_round_trips() {
        let event = Event::CaptureStopped;
        let encoded = encode_event(&event).unwrap();
        let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
        assert_eq!(decode_event(line).unwrap(), event);
    }

    #[test]
    fn capture_source_kinds_serialize_lowercase() {
        let monitor = serde_json::to_string(&CaptureSourceKind::Monitor).unwrap();
        let window = serde_json::to_string(&CaptureSourceKind::Window).unwrap();
        assert_eq!(monitor, r#""monitor""#);
        assert_eq!(window, r#""window""#);
    }

    #[test]
    fn auth_round_trips() {
        let cmd = Command::Auth {
            token: "abc123".into(),
            pipe_id: "deadbeef".into(),
        };
        let encoded = encode_command(&cmd).unwrap();
        let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
        assert_eq!(decode_command(line).unwrap(), cmd);
    }

    #[test]
    fn hello_round_trips() {
        let cmd = Command::Hello { token: "abc123".into() };
        let encoded = encode_command(&cmd).unwrap();
        let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
        assert_eq!(decode_command(line).unwrap(), cmd);
    }

    #[test]
    fn ready_event_round_trips() {
        let event = Event::Ready {
            version: PROTOCOL_VERSION,
            pid: 1234,
            pipe: r"\\.\pipe\sonicplank-deadbeef".into(),
            shm_name: r"Local\SonicPlankOverlay-deadbeef".into(),
            shm_size: 8_294_412,
        };
        let encoded = encode_event(&event).unwrap();
        let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
        assert_eq!(decode_event(line).unwrap(), event);
    }

    #[test]
    fn pong_event_round_trips() {
        let event = Event::Pong { version: PROTOCOL_VERSION };
        let encoded = encode_event(&event).unwrap();
        let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
        assert_eq!(decode_event(line).unwrap(), event);
    }

    #[test]
    fn error_event_round_trips() {
        let event = Event::Error {
            code: ErrorCode::IpcError,
            message: "test error".into(),
        };
        let encoded = encode_event(&event).unwrap();
        let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
        assert_eq!(decode_event(line).unwrap(), event);
    }

    #[test]
    fn frame_ends_with_newline() {
        let bytes = encode_command(&Command::Ping).unwrap();
        assert_eq!(*bytes.last().unwrap(), b'\n');
    }

    #[test]
    fn decode_trims_whitespace() {
        assert!(decode_command("  {\"type\":\"ping\"}  ").is_ok());
    }

    #[test]
    fn unknown_type_returns_error() {
        assert!(decode_command(r#"{"type":"not_a_real_command"}"#).is_err());
    }

    // ── Wire format tests ─────────────────────────────────────────────────────

    #[test]
    fn ping_wire_format() {
        let bytes = encode_command(&Command::Ping).unwrap();
        assert_eq!(String::from_utf8(bytes).unwrap(), "{\"type\":\"ping\"}\n");
    }

    #[test]
    fn ready_wire_format() {
        let bytes = encode_event(&Event::Ready {
            version: 1,
            pid: 0,
            pipe: r"\\.\pipe\sonicplank-test".into(),
            shm_name: r"Local\SonicPlankOverlay-test".into(),
            shm_size: 8_294_412,
        })
        .unwrap();
        assert_eq!(
            String::from_utf8(bytes).unwrap(),
            "{\"type\":\"ready\",\"version\":1,\"pid\":0,\"pipe\":\"\\\\\\\\.\\\\\
pipe\\\\sonicplank-test\",\"shm_name\":\"Local\\\\SonicPlankOverlay-test\",\"shm_size\":8294412}\n"
        );
    }

    // ── Frame header tests ────────────────────────────────────────────────────

    #[test]
    fn frame_header_encode_decode_round_trips() {
        let header = FrameHeader {
            frame_type: FrameType::VideoPreview,
            payload_len: 921_600, // 640×360×4 bytes
        };
        let encoded = encode_frame_header(&header);
        let decoded = decode_frame_header(&encoded).unwrap();
        assert_eq!(decoded, header);
    }

    #[test]
    fn frame_header_is_little_endian() {
        let header = FrameHeader {
            frame_type: FrameType::VideoPreview,
            payload_len: 0x0102_0304,
        };
        let buf = encode_frame_header(&header);
        // frame_type = 1 (VideoPreview) in LE
        assert_eq!(&buf[..4], &[0x01, 0x00, 0x00, 0x00]);
        // payload_len = 0x01020304 in LE
        assert_eq!(&buf[4..], &[0x04, 0x03, 0x02, 0x01]);
    }

    #[test]
    fn frame_header_unknown_type_returns_error() {
        let buf: [u8; 8] = [0xFF, 0xFF, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
        assert!(decode_frame_header(&buf).is_err());
    }

    #[test]
    fn frame_header_size_is_eight_bytes() {
        let header = FrameHeader {
            frame_type: FrameType::VideoPreview,
            payload_len: 0,
        };
        assert_eq!(encode_frame_header(&header).len(), 8);
    }

    // ── Property-based tests ──────────────────────────────────────────────────

    proptest! {
        #[test]
        fn error_message_survives_round_trip(msg in "[\\w ]{1,256}") {
            let event = Event::Error { code: ErrorCode::Unknown, message: msg.clone() };
            let encoded = encode_event(&event).unwrap();
            let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
            let decoded = decode_event(line).unwrap();
            prop_assert_eq!(decoded, event);
        }

        #[test]
        fn ready_pid_survives_round_trip(pid in 1u32..=4_194_304u32) {
            let event = Event::Ready {
                version: PROTOCOL_VERSION,
                pid,
                pipe: r"\\.\pipe\sonicplank-test".into(),
                shm_name: r"Local\SonicPlankOverlay-test".into(),
                shm_size: 8_294_412,
            };
            let encoded = encode_event(&event).unwrap();
            let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
            if let Event::Ready { pid: decoded_pid, .. } = decode_event(line).unwrap() {
                prop_assert_eq!(decoded_pid, pid);
            }
        }

        #[test]
        fn frame_header_payload_len_survives_round_trip(len in 0u32..=u32::MAX) {
            let header = FrameHeader {
                frame_type: FrameType::VideoPreview,
                payload_len: len,
            };
            let buf = encode_frame_header(&header);
            let decoded = decode_frame_header(&buf).unwrap();
            prop_assert_eq!(decoded.payload_len, len);
        }

        #[test]
        fn auth_token_and_pipe_id_survive_round_trip(
            token in "[A-Za-z0-9_-]{43}",
            pipe_id in "[0-9a-f]{32}",
        ) {
            let cmd = Command::Auth { token: token.clone(), pipe_id: pipe_id.clone() };
            let encoded = encode_command(&cmd).unwrap();
            let line = std::str::from_utf8(&encoded[..encoded.len() - 1]).unwrap();
            if let Command::Auth { token: t, pipe_id: p } = decode_command(line).unwrap() {
                prop_assert_eq!(t, token);
                prop_assert_eq!(p, pipe_id);
            }
        }
    }
}
