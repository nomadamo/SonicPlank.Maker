#![allow(unsafe_code)]

use std::collections::HashMap;
use std::ffi::CString;
use std::ptr;
use std::sync::atomic::{AtomicI32, Ordering};
use std::sync::{Arc, OnceLock, RwLock};
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use ffmpeg_sys_next::*;
use serde::Deserialize;
use tokio::sync::{broadcast, mpsc};
use windows::Win32::System::Threading::{GetCurrentThread, SetThreadPriority, THREAD_PRIORITY_HIGHEST};

use crate::capture::RawFrame;
use sonicplank_ipc::StreamSourceDef;

// Removed CompositeFrame

/// Per-encoder tuning loaded from `encoder-config.json` at stream start.
/// Settings that come from Electron (bitrate, fps, resolution, encoder name)
/// are not here - they live in StreamOptions.
#[derive(Debug, Deserialize, Default, Clone)]
pub struct EncoderPreset {
    /// Arbitrary key/value pairs forwarded to av_opt_set on the codec's priv_data.
    #[serde(default)]
    pub options: HashMap<String, String>,
}

#[derive(Debug, Deserialize, Default, Clone)]
pub struct EncoderConfig {
    #[serde(default)]
    pub bitrate_kbps: u32,
    #[serde(default)]
    pub libx264: EncoderPreset,
    #[serde(default)]
    pub h264_nvenc: EncoderPreset,
    #[serde(default)]
    pub h264_amf: EncoderPreset,
    #[serde(default)]
    pub h264_qsv: EncoderPreset,
}

fn load_encoder_config() -> EncoderConfig {
    // Look next to the binary first, then in the current working directory.
    // In dev, Electron spawns core from the project root, so encoder-config.json
    // placed there is found via current_dir.
    let candidates: Vec<std::path::PathBuf> = [
        std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.join("encoder-config.json"))),
        std::env::current_dir().ok().map(|d| d.join("encoder-config.json")),
    ]
    .into_iter()
    .flatten()
    .collect();

    for path in &candidates {
        match std::fs::read_to_string(path) {
            Ok(content) => match serde_json::from_str::<EncoderConfig>(&content) {
                Ok(cfg) => {
                    tracing::info!("encoder config loaded from {}", path.display());
                    return cfg;
                }
                Err(e) => tracing::warn!("encoder-config.json parse error at {}: {e}", path.display()),
            },
            Err(_) => {}
        }
    }

    tracing::info!(
        "encoder-config.json not found (searched: {}); using built-in defaults",
        candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", ")
    );
    EncoderConfig::default()
}

// ── Global config cache ───────────────────────────────────────────────────────

static ENCODER_CONFIG: OnceLock<Arc<RwLock<EncoderConfig>>> = OnceLock::new();

fn config_cache() -> Arc<RwLock<EncoderConfig>> {
    Arc::clone(ENCODER_CONFIG.get_or_init(|| {
        Arc::new(RwLock::new(load_encoder_config()))
    }))
}

/// Start a background thread that watches for `encoder-config.json` changes and
/// reloads the in-memory cache. Changes apply on the next stream start - FFmpeg
/// does not allow re-configuring an encoder that is already open.
pub fn start_config_watcher() {
    use notify::{recommended_watcher, RecursiveMode, Watcher};

    // Collect candidate directories to watch (binary dir and CWD), deduplicated.
    let mut watch_dirs: Vec<std::path::PathBuf> = Vec::new();
    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(std::path::Path::to_path_buf))
    {
        watch_dirs.push(exe_dir);
    }
    if let Ok(cwd) = std::env::current_dir() {
        if !watch_dirs.contains(&cwd) {
            watch_dirs.push(cwd);
        }
    }
    if watch_dirs.is_empty() {
        tracing::warn!("no watchable directories found; encoder config live-reload disabled");
        return;
    }

    let cache = config_cache();

    std::thread::spawn(move || {
        let (tx, rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();
        let mut watcher = match recommended_watcher(move |res| {
            let _ = tx.send(res);
        }) {
            Ok(w) => w,
            Err(e) => {
                tracing::warn!("file watcher init failed: {e}");
                return;
            }
        };

        for dir in &watch_dirs {
            match watcher.watch(dir.as_path(), RecursiveMode::NonRecursive) {
                Ok(()) => tracing::info!("encoder config watcher: watching {}", dir.display()),
                Err(e) => tracing::warn!("encoder config watcher: cannot watch {}: {e}", dir.display()),
            }
        }

        for res in rx {
            match res {
                Ok(event) => {
                    let is_config = event.paths.iter().any(|p| {
                        p.file_name()
                            .map(|n| n == "encoder-config.json")
                            .unwrap_or(false)
                    });
                    if !is_config {
                        continue;
                    }
                    // Try each candidate path and load the first that parses cleanly.
                    for dir in &watch_dirs {
                        let path = dir.join("encoder-config.json");
                        match std::fs::read_to_string(&path) {
                            Ok(content) => match serde_json::from_str::<EncoderConfig>(&content) {
                                Ok(cfg) => {
                                    tracing::info!(
                                        "encoder config reloaded from {} — \
                                         bitrate_kbps={} \
                                         nvenc_opts={:?} \
                                         x264_opts={:?} \
                                         amf_opts={:?} \
                                         qsv_opts={:?}",
                                        path.display(),
                                        cfg.bitrate_kbps,
                                        cfg.h264_nvenc.options,
                                        cfg.libx264.options,
                                        cfg.h264_amf.options,
                                        cfg.h264_qsv.options,
                                    );
                                    if let Ok(mut guard) = cache.write() {
                                        *guard = cfg;
                                    }
                                    break;
                                }
                                Err(e) => tracing::warn!("encoder-config.json parse error: {e}"),
                            },
                            Err(_) => {}
                        }
                    }
                }
                Err(e) => tracing::warn!("file watcher error: {e}"),
            }
        }
    });
}

// ── Async RTMP write types ────────────────────────────────────────────────────

/// An encoded AVPacket delivered to the RTMP writer thread via channel.
/// Drop calls av_packet_free, which calls av_packet_unref internally.
struct OwnedPacket(*mut AVPacket);
unsafe impl Send for OwnedPacket {}
impl Drop for OwnedPacket {
    fn drop(&mut self) {
        unsafe { av_packet_free(&mut self.0); }
    }
}

/// Carries the raw AVFormatContext pointer across the thread boundary.
/// The RTMP write thread takes ownership after the header is written.
struct FormatCtxSend(*mut AVFormatContext);
unsafe impl Send for FormatCtxSend {}
impl FormatCtxSend {
    /// Consumes the wrapper and returns the raw pointer.
    /// Using a method here ensures the closure captures `FormatCtxSend` (Send),
    /// not the inner `*mut AVFormatContext` field (not Send per RFC 2229).
    fn into_raw(self) -> *mut AVFormatContext { self.0 }
}

struct PipScaler {
    sws: *mut SwsContext,
    src_w: i32,
    src_h: i32,
    dst_w: i32,
    dst_h: i32,
}

impl Drop for PipScaler {
    fn drop(&mut self) {
        if !self.sws.is_null() {
            unsafe { sws_freeContext(self.sws); }
        }
    }
}

// ── Public interface ──────────────────────────────────────────────────────────

pub struct StreamOptions {
    pub rtmp_url: String,
    pub bitrate_kbps: u32,
    pub fps: u32,
    pub output_width: Option<u32>,
    pub output_height: Option<u32>,
    pub fit_mode: Option<String>,
    /// "libx264" | "h264_nvenc" | "h264_amf" | "h264_qsv"
    pub encoder: String,
    pub sources: Vec<StreamSourceDef>,
    pub audio_device_id: Option<String>,
}

#[derive(Debug)]
pub enum StreamEvent {
    Started { width: u32, height: u32 },
    Status { frame: u64, fps: f32, bitrate_kbps: u32 },
    Error(String),
    Stopped,
}

pub struct StreamSession {
    stop_tx: std::sync::mpsc::SyncSender<()>,
    thread: Option<std::thread::JoinHandle<()>>,
    _audio_stream: Option<cpal::Stream>,
}

impl StreamSession {
    pub fn start(
        opts: StreamOptions,
        frame_rx: broadcast::Receiver<Arc<RawFrame>>,
        event_tx: mpsc::UnboundedSender<StreamEvent>,
        shared_overlay: crate::capture::SharedOverlay,
    ) -> Self {
        let (stop_tx, stop_rx) = std::sync::mpsc::sync_channel::<()>(1);

        // Try to start audio capture.
        let mut audio_capture = None;
        if let Some(ref dev_id) = opts.audio_device_id {
            match crate::audio::start_audio_capture(dev_id) {
                Ok((stream, cons, config)) => {
                    tracing::info!("Started audio capture on device '{}', config: {:?}", dev_id, config);
                    audio_capture = Some((stream, cons, config));
                }
                Err(e) => {
                    tracing::error!("Failed to start audio capture on device '{}': {e}", dev_id);
                }
            }
        }

        let (audio_stream, audio_cons, audio_config) = if let Some((stream, cons, config)) = audio_capture {
            (Some(stream), Some(cons), Some(config))
        } else {
            (None, None, None)
        };

        // Bridge: async broadcast receiver -> bounded sync channel for the encoder thread.
        let (bridge_tx, bridge_rx) = std::sync::mpsc::sync_channel::<Arc<RawFrame>>(8);
        let bridge_evt = event_tx.clone();

        tokio::spawn(async move {
            let mut rx = frame_rx;
            loop {
                match rx.recv().await {
                    Ok(frame) => {
                        if bridge_tx.try_send(frame).is_err() {
                            tracing::trace!("encoder lagging - frame dropped");
                        }
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                        tracing::trace!("encoder missed {n} broadcast frames (lagged)");
                    }
                    Err(broadcast::error::RecvError::Closed) => {
                        let _ = bridge_evt.send(StreamEvent::Stopped);
                        break;
                    }
                }
            }
        });

        let thread = std::thread::spawn(move || {
            if let Err(e) = run_encoder(opts, bridge_rx, audio_cons, audio_config, stop_rx, &event_tx, shared_overlay) {
                tracing::error!("stream encoder error: {e:#}");
                let _ = event_tx.send(StreamEvent::Error(format!("{e:#}")));
            }
            let _ = event_tx.send(StreamEvent::Stopped);
        });

        Self { stop_tx, thread: Some(thread), _audio_stream: audio_stream }
    }

    pub fn stop(&mut self) {
        let _ = self.stop_tx.try_send(());
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

impl Drop for StreamSession {
    fn drop(&mut self) {
        self.stop();
    }
}

// ── Encoder thread ────────────────────────────────────────────────────────────

fn run_encoder(
    opts: StreamOptions,
    frame_rx: std::sync::mpsc::Receiver<Arc<RawFrame>>,
    audio_cons: Option<ringbuf::HeapCons<f32>>,
    audio_config: Option<cpal::StreamConfig>,
    stop_rx: std::sync::mpsc::Receiver<()>,
    event_tx: &mpsc::UnboundedSender<StreamEvent>,
    shared_overlay: crate::capture::SharedOverlay,
) -> Result<()> {
    // Clone config while the lock is briefly held - avoids holding RwLock across unsafe FFI.
    let enc_cfg = config_cache()
        .read()
        .map_err(|_| anyhow!("encoder config lock poisoned"))?
        .clone();
    unsafe { run_encoder_unsafe(opts, enc_cfg, frame_rx, audio_cons, audio_config, stop_rx, event_tx, shared_overlay) }
}

unsafe fn run_encoder_unsafe(
    opts: StreamOptions,
    enc_cfg: EncoderConfig,
    frame_rx: std::sync::mpsc::Receiver<Arc<RawFrame>>,
    audio_cons: Option<ringbuf::HeapCons<f32>>,
    audio_config: Option<cpal::StreamConfig>,
    stop_rx: std::sync::mpsc::Receiver<()>,
    event_tx: &mpsc::UnboundedSender<StreamEvent>,
    shared_overlay: crate::capture::SharedOverlay,
) -> Result<()> {
    // Elevate thread priority to prevent Windows Game Mode from starving the 
    // background encode thread while the user plays the game.
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST);

    av_log_set_level(AV_LOG_WARNING);

    // ── Wait for the first frame (gives us source dimensions) ─────────────────
    let first = frame_rx
        .recv_timeout(Duration::from_secs(5))
        .map_err(|_| anyhow!("timed out waiting for first frame before stream start"))?;

    let src_w = first.width as i32;
    let src_h = first.height as i32;
    let out_w = (opts.output_width.unwrap_or(first.width) & !1) as i32;
    let out_h = (opts.output_height.unwrap_or(first.height) & !1) as i32;
    let fit_mode = opts.fit_mode.unwrap_or_else(|| "contain".to_string());

    let out_aspect = out_w as f32 / out_h as f32;
    let src_aspect = src_w as f32 / src_h as f32;

    let mut crop_w = src_w;
    let mut crop_h = src_h;
    let mut crop_x = 0;
    let mut crop_y = 0;

    let mut dst_w = out_w;
    let mut dst_h = out_h;
    let mut dst_x = 0;
    let mut dst_y = 0;

    if fit_mode == "cover" {
        if src_aspect > out_aspect {
            crop_w = (src_h as f32 * out_aspect).round() as i32 & !1;
            crop_x = (src_w - crop_w) / 2 & !1;
        } else if src_aspect < out_aspect {
            crop_h = (src_w as f32 / out_aspect).round() as i32 & !1;
            crop_y = (src_h - crop_h) / 2 & !1;
        }
    } else if fit_mode == "contain" {
        if src_aspect > out_aspect {
            dst_h = (out_w as f32 / src_aspect).round() as i32 & !1;
            dst_y = (out_h - dst_h) / 2 & !1;
        } else if src_aspect < out_aspect {
            dst_w = (out_h as f32 * src_aspect).round() as i32 & !1;
            dst_x = (out_w - dst_w) / 2 & !1;
        }
    }

    let target_fps = opts.fps.max(1);
    // How long to wait for the next WGC frame before repeating the last one.
    // Using 2× the frame interval so a brief capture hitch doesn't immediately
    // repeat, but a genuine stall (e.g. WGC stopped) keeps the CBR bitrate filled.
    let frame_wait = Duration::from_millis((2000 / target_fps) as u64);

    // ── Output format context (FLV over RTMP) ─────────────────────────────────
    let url_c = CString::new(opts.rtmp_url.as_str()).context("invalid RTMP URL")?;
    let flv_c = CString::new("flv")?;
    let mut ofmt_ctx: *mut AVFormatContext = ptr::null_mut();
    check(
        avformat_alloc_output_context2(&mut ofmt_ctx, ptr::null(), flv_c.as_ptr(), url_c.as_ptr()),
        "avformat_alloc_output_context2",
    )?;

    // ── Find encoder ──────────────────────────────────────────────────────────
    let enc_name = CString::new(opts.encoder.as_str())?;
    let mut codec = avcodec_find_encoder_by_name(enc_name.as_ptr());
    if codec.is_null() {
        tracing::warn!("encoder '{}' not found - falling back to libx264", opts.encoder);
        let fallback = CString::new("libx264")?;
        codec = avcodec_find_encoder_by_name(fallback.as_ptr());
    }
    if codec.is_null() {
        avformat_free_context(ofmt_ctx);
        return Err(anyhow!("no H.264 encoder found"));
    }

    // ── Add video stream & codec context ─────────────────────────────────────
    let out_stream = avformat_new_stream(ofmt_ctx, ptr::null());
    if out_stream.is_null() {
        avformat_free_context(ofmt_ctx);
        return Err(anyhow!("avformat_new_stream failed"));
    }

    let codec_ctx = avcodec_alloc_context3(codec);
    if codec_ctx.is_null() {
        avformat_free_context(ofmt_ctx);
        return Err(anyhow!("avcodec_alloc_context3 failed"));
    }

    (*codec_ctx).codec_id   = (*codec).id;
    (*codec_ctx).bit_rate   = (opts.bitrate_kbps as i64) * 1000;
    (*codec_ctx).width      = out_w;
    (*codec_ctx).height     = out_h;
    (*codec_ctx).time_base  = AVRational { num: 1, den: target_fps as i32 };
    (*codec_ctx).framerate  = AVRational { num: target_fps as i32, den: 1 };
    (*codec_ctx).pix_fmt    = AVPixelFormat::AV_PIX_FMT_YUV420P;

    if !(*ofmt_ctx).oformat.is_null()
        && ((*(*ofmt_ctx).oformat).flags & AVFMT_GLOBALHEADER as i32) != 0
    {
        (*codec_ctx).flags |= AV_CODEC_FLAG_GLOBAL_HEADER as i32;
    }

    let preset = match opts.encoder.as_str() {
        "h264_nvenc" => &enc_cfg.h264_nvenc,
        "h264_amf"   => &enc_cfg.h264_amf,
        "h264_qsv"   => &enc_cfg.h264_qsv,
        _            => &enc_cfg.libx264,   // "libx264" | "" | unknown
    };

    // 2-second keyframe interval for all encoders
    (*codec_ctx).gop_size = (target_fps * 2) as i32;

    // Encoder-specific tuning applied before av_opt_set options
    if opts.encoder == "h264_nvenc" {
        // B-frames add interleaving delay: av_interleaved_write_frame buffers 2-3 packets
        // and flushes in bursts, causing large TCP writes that block for 300-1000ms.
        // 0 B-frames = one packet per frame, written immediately, no burst writes.
        (*codec_ctx).max_b_frames = 0;
        // NVENC CBR: rc_max_rate = rc_buffer_size = bit_rate for stable CBR
        (*codec_ctx).rc_max_rate = (*codec_ctx).bit_rate;
        (*codec_ctx).rc_buffer_size = (*codec_ctx).bit_rate as i32;
    }

    for (key, val) in &preset.options {
        set_opt(codec_ctx, key, val);
    }

    // ── Dump full encoder config before opening codec ─────────────────────────
    {
        let mut opts_sorted: Vec<(&String, &String)> = preset.options.iter().collect();
        opts_sorted.sort_by_key(|(k, _)| k.as_str());
        let opts_str = opts_sorted
            .iter()
            .map(|(k, v)| format!("{k}={v}"))
            .collect::<Vec<_>>()
            .join(", ");

        tracing::info!(
            "Encoder config  encoder={} bitrate={}kbps fps={} gop={} \
             size={}x{}{}x{} rc_max_rate={}kbps rc_buf={}kbps max_b={} \
             opts=[{}]",
            opts.encoder,
            opts.bitrate_kbps,
            target_fps,
            (*codec_ctx).gop_size,
            src_w, src_h, out_w, out_h,
            (*codec_ctx).rc_max_rate / 1000,
            (*codec_ctx).rc_buffer_size as i64 / 1000,
            (*codec_ctx).max_b_frames,
            opts_str,
        );
    }

    check(avcodec_open2(codec_ctx, codec, ptr::null_mut()), "avcodec_open2")?;
    check(avcodec_parameters_from_context((*out_stream).codecpar, codec_ctx),
          "avcodec_parameters_from_context")?;
    (*out_stream).time_base = (*codec_ctx).time_base;

    // ── Setup Audio Encoder ───────────────────────────────────────────────────
    let mut audio_enc = if let (Some(cons), Some(config)) = (audio_cons, audio_config) {
        match crate::audio_encoder::AudioEncoder::new(ofmt_ctx, &config, cons) {
            Ok(enc) => Some(enc),
            Err(e) => {
                tracing::error!("Failed to initialize audio encoder: {e}");
                None
            }
        }
    } else {
        None
    };

    // ── Open RTMP output & write header ───────────────────────────────────────
    // rw_timeout (µs): caps how long avio blocks on a single TCP read/write.
    // Without this, av_interleaved_write_frame can block indefinitely on a
    // stalled RTMP server. 5 s is generous for live streaming.
    let rw_timeout_us = CString::new("5000000")?;
    let rw_timeout_key = CString::new("rw_timeout")?;
    let mut io_opts: *mut AVDictionary = ptr::null_mut();
    av_dict_set(&mut io_opts, rw_timeout_key.as_ptr(), rw_timeout_us.as_ptr(), 0);
    let ret = avio_open2(&mut (*ofmt_ctx).pb, url_c.as_ptr(), AVIO_FLAG_WRITE as i32,
                         ptr::null(), &mut io_opts);
    av_dict_free(&mut io_opts);
    check(ret, "avio_open2 - check RTMP URL and network")?;
    check(avformat_write_header(ofmt_ctx, ptr::null_mut()),
          "avformat_write_header - RTMP server rejected connection")?;

    if let Some(ref mut enc) = audio_enc {
        unsafe { enc.update_stream_timebase(ofmt_ctx); }
    }

    tracing::info!(
        "Stream started: {}x{} (mode: {})  {}x{} @{}fps via {} at {}kbps",
        src_w, src_h, fit_mode, out_w, out_h, target_fps, opts.encoder, opts.bitrate_kbps
    );
    event_tx.send(StreamEvent::Started { width: out_w as u32, height: out_h as u32 }).ok();

    // ── Async RTMP write thread ───────────────────────────────────────────────
    // av_interleaved_write_frame blocks the calling thread on TCP backpressure
    // (measured at 110–1138ms per call). Moving RTMP I/O to a dedicated thread
    // lets the encode loop run at full capture rate regardless of network speed.
    //
    // Capture stream/codec metadata before transferring ofmt_ctx ownership.
    let out_stream_tb  = (*out_stream).time_base;
    let out_stream_idx = (*out_stream).index;
    let codec_tb       = (*codec_ctx).time_base;

    // 300 packets ≈ 5 s of headroom at 60 fps. The encode loop skips encoding when
    // the queue is >80% full so we never burn CPU on sws_scale for frames that would
    // just be dropped.
    const QUEUE_CAP: i32 = 300;
    const QUEUE_SKIP_THRESHOLD: i32 = 240; // 80%
    let (pkt_tx, pkt_rx) = std::sync::mpsc::sync_channel::<OwnedPacket>(QUEUE_CAP as usize);
    let fmt_send = FormatCtxSend(ofmt_ctx);
    // ofmt_ctx is now logically owned by rtmp_writer; do not touch it in this thread.

    // Approximate queue occupancy shared between encode and RTMP threads.
    let queue_depth      = Arc::new(AtomicI32::new(0));
    let queue_depth_rtmp = Arc::clone(&queue_depth);

    // When the user stops the stream, we set this flag so the RTMP thread exits
    // immediately rather than draining the entire queue (which at 300ms/write
    // would take up to 90 seconds for a full 300-packet queue).
    let rtmp_stop      = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let rtmp_stop_rtmp = Arc::clone(&rtmp_stop);

    let rtmp_writer = std::thread::Builder::new()
        .name("rtmp-writer".into())
        .spawn(move || {
            // into_raw() is a method call, so Rust captures FormatCtxSend (Send)
            // rather than the inner field *mut AVFormatContext (not Send).
            let ofmt_ctx = fmt_send.into_raw();
            let mut total_pkts: u64 = 0;
            let mut slow_writes: u64 = 0;

            while let Ok(owned) = pkt_rx.recv() {
                if rtmp_stop_rtmp.load(Ordering::Relaxed) {
                    // Forced stop: drop this and all remaining queued packets without writing.
                    // pkt_rx goes out of scope when the closure returns, draining the rest.
                    break;
                }
                queue_depth_rtmp.fetch_sub(1, Ordering::Relaxed);
                let t = Instant::now();
                unsafe {
                    if av_write_frame(ofmt_ctx, owned.0) < 0 {
                        tracing::error!("av_write_frame error (pkt #{}) - aborting RTMP writer", total_pkts);
                        break;
                    }
                }
                let ms = t.elapsed().as_millis();
                total_pkts += 1;
                if ms > 50 { slow_writes += 1; }
                // owned drops here  av_packet_free called
            }

            tracing::info!("RTMP writer done: {total_pkts} pkts written, {slow_writes} slow (>50ms)");
            unsafe {
                av_write_trailer(ofmt_ctx);
                avio_closep(&mut (*ofmt_ctx).pb);
                avformat_free_context(ofmt_ctx);
            }
        })
        .expect("failed to spawn rtmp-writer thread");

    // ── Scaling context (BGRA  YUV420P) ─────────────────────────────────────
    let sws = sws_getContext(
        crop_w, crop_h, AVPixelFormat::AV_PIX_FMT_BGRA,
        dst_w, dst_h, AVPixelFormat::AV_PIX_FMT_YUV420P,
        SWS_FAST_BILINEAR as i32,
        ptr::null_mut(), ptr::null_mut(), ptr::null(),
    );
    if sws.is_null() {
        return Err(anyhow!("sws_getContext failed"));
    }

    // ── Allocate reusable YUV frame and packet ────────────────────────────────
    let yuv_frame = av_frame_alloc();
    (*yuv_frame).format = AVPixelFormat::AV_PIX_FMT_YUV420P as i32;
    (*yuv_frame).width  = out_w;
    (*yuv_frame).height = out_h;
    av_frame_get_buffer(yuv_frame, 0);

    // Initialize frame to black so that letterboxing/pillarboxing ("contain" mode) 
    // has clean black edges outside the sws_scale target area.
    std::ptr::write_bytes((*yuv_frame).data[0], 16, ((*yuv_frame).linesize[0] * out_h) as usize);
    std::ptr::write_bytes((*yuv_frame).data[1], 128, ((*yuv_frame).linesize[1] * out_h / 2) as usize);
    std::ptr::write_bytes((*yuv_frame).data[2], 128, ((*yuv_frame).linesize[2] * out_h / 2) as usize);

    let pkt = av_packet_alloc();
    let shared_overlay_enc = Arc::clone(&shared_overlay);

    // ── Encode loop ───────────────────────────────────────────────────────────
    let stream_start = Instant::now();
    let mut last_pts: i64 = -1;
    let mut frames_sent:   u64 = 0;  // packets successfully queued to RTMP thread
    let mut calls_this_interval: u64 = 0;  // actual encode_frame invocations
    let mut frames_this_interval: u64 = 0; // successful sends (for fps + bitrate)
    let mut total_frames: u64 = 0;
    let mut bytes_since_status: u64 = 0;
    let mut last_status = Instant::now();
    let mut sws_ms_acc:   f64 = 0.0;
    let mut nvenc_ms_acc: f64 = 0.0;
    let mut recv_ms_acc:  f64 = 0.0;
    let mut pkts_dropped:  u64 = 0; // dropped inside encode_frame (queue full at send time)
    let mut frames_skipped: u64 = 0; // skipped before encode (queue ≥80% full)

    // Encode the first frame.
    calls_this_interval += 1;
    let mut first_pts = 0;
    let mut pip_scalers: HashMap<String, PipScaler> = HashMap::new();
    encode_frame(codec_ctx, sws, yuv_frame, pkt,
                 crop_h, crop_x, crop_y, dst_h, dst_x, dst_y, &first, &mut frames_this_interval, &mut bytes_since_status,
                 &mut first_pts, &mut sws_ms_acc, &mut nvenc_ms_acc, &mut recv_ms_acc,
                 &pkt_tx, codec_tb, out_stream_tb, out_stream_idx,
                 &mut pkts_dropped, &queue_depth)?;
    last_pts = 0;
    total_frames += 1;
    let mut last_frame: Arc<RawFrame> = first;

    let mut sleeper = spin_sleep::SpinSleeper::default();

    let mut forced_stop = false;
    loop {
        if stop_rx.try_recv().is_ok() { forced_stop = true; break; }

        if let Some(ref mut enc) = audio_enc {
            let mut send_audio = |pkt: *mut AVPacket| -> Result<()> {
                queue_depth.fetch_add(1, Ordering::Relaxed);
                bytes_since_status += unsafe { (*pkt).size } as u64;
                if pkt_tx.try_send(OwnedPacket(pkt)).is_err() {
                    pkts_dropped += 1;
                    queue_depth.fetch_sub(1, Ordering::Relaxed);
                }
                Ok(())
            };
            if let Err(e) = enc.poll(stream_start.elapsed().as_secs_f64(), &mut send_audio) {
                tracing::warn!("Audio encode error: {}", e);
            }
        }

        let elapsed_secs = stream_start.elapsed().as_secs_f64();
        let ideal_pts = (elapsed_secs * target_fps as f64).round() as i64;
        
        let mut current_pts = last_pts + 1;
        if ideal_pts > current_pts + 1 {
            // We fell behind real-time. Drop exactly ONE frame to smoothly pace catch-up 
            // without chunked stutters (e.g., effectively outputs 30 FPS instead of 60 FPS 
            // uniformly, rather than dropping 3 frames at once and causing a huge visual jerk).
            frames_skipped += 1;
            last_pts = current_pts;
            continue; // Physically skip encoding this frame to save CPU
        }

        let target_time_secs = current_pts as f64 / target_fps as f64;
        let target_duration = Duration::from_secs_f64(target_time_secs);
        let elapsed = stream_start.elapsed();

        if target_duration > elapsed {
            sleeper.sleep(target_duration - elapsed);
        }

        let raw = {
            let mut newest: Option<Arc<RawFrame>> = None;
            while let Ok(f) = frame_rx.try_recv() { newest = Some(f); }
            if let Some(f) = newest { f } else { last_frame.clone() }
        };

        last_frame = raw.clone();
        last_pts = current_pts;

        // Skip encoding entirely when the RTMP queue is >=80% full.
        // This avoids wasting ~6ms of CPU per frame on sws+NVENC for packets
        // that would just be dropped anyway.
        if queue_depth.load(Ordering::Relaxed) >= QUEUE_SKIP_THRESHOLD {
            frames_skipped += 1;
        } else {
            calls_this_interval += 1;
            let mut enc_pts = current_pts;
            encode_frame(codec_ctx, sws, yuv_frame, pkt,
                         crop_h, crop_x, crop_y, dst_h, dst_x, dst_y, &raw, &mut frames_this_interval,
                         &mut bytes_since_status, &mut enc_pts,
                         &mut sws_ms_acc, &mut nvenc_ms_acc, &mut recv_ms_acc,
                         &pkt_tx, codec_tb, out_stream_tb, out_stream_idx,
                         &mut pkts_dropped, &queue_depth)?;
            total_frames += 1;
        }

        // Emit status roughly once per second.
        let elapsed = last_status.elapsed();
        if elapsed >= Duration::from_secs(1) {
            let bitrate_kbps =
                ((bytes_since_status * 8) / elapsed.as_millis().max(1) as u64) as u32;
            let fps = frames_this_interval as f32 / elapsed.as_secs_f32();
            let n = calls_this_interval.max(1) as f64;
            let qd = queue_depth.load(Ordering::Relaxed);
            tracing::info!(
                "Stream status: {fps:.1}fps {bitrate_kbps}kbps | \
                 sws={:.1}ms send={:.1}ms recv={:.1}ms | \
                 queue={}/{QUEUE_CAP} skipped={frames_skipped} dropped={pkts_dropped}",
                sws_ms_acc / n, nvenc_ms_acc / n, recv_ms_acc / n, qd,
            );
            event_tx.send(StreamEvent::Status {
                frame: total_frames,
                fps,
                bitrate_kbps,
            }).ok();
            last_status = Instant::now();
            bytes_since_status = 0;
            frames_this_interval = 0;
            calls_this_interval  = 0;
            sws_ms_acc    = 0.0;
            nvenc_ms_acc  = 0.0;
            recv_ms_acc   = 0.0;
            pkts_dropped  = 0;
            frames_skipped = 0;
        }
    }

    if forced_stop {
        // User stopped the stream: signal RTMP thread to exit immediately.
        // Remaining queued packets are dropped by the RTMP thread and when
        // pkt_rx goes out of scope. Avoids a 30-90 second drain at 300ms/write.
        rtmp_stop.store(true, Ordering::Relaxed);
    } else {
        // Normal end (capture disconnected): flush remaining NVENC frames.
        avcodec_send_frame(codec_ctx, ptr::null_mut());
        loop {
            let ret = avcodec_receive_packet(codec_ctx, pkt);
            if ret == AVERROR(EAGAIN) || ret == AVERROR_EOF { break; }
            if ret < 0 { break; }
            let new_pkt = av_packet_alloc();
            av_packet_move_ref(new_pkt, pkt);
            av_packet_rescale_ts(new_pkt, codec_tb, out_stream_tb);
            (*new_pkt).stream_index = out_stream_idx;
            // try_send: if queue is full at flush time, drop the packet rather
            // than blocking the encode thread indefinitely at shutdown.
            let _ = pkt_tx.try_send(OwnedPacket(new_pkt));
        }
    }

    // Signal RTMP thread to drain and exit.
    drop(pkt_tx);

    // ── Cleanup encode resources (ofmt_ctx is owned by rtmp_writer) ──────────
    av_frame_free(&mut (yuv_frame as *mut _));
    av_packet_free(&mut (pkt as *mut _));
    sws_freeContext(sws);
    avcodec_free_context(&mut (codec_ctx as *mut _));

    // Wait for RTMP thread to write remaining packets, trailer, and close.
    let _ = rtmp_writer.join();

    tracing::info!("Stream encoder exited cleanly");
    Ok(())
}

// Overlays are handled by the compositor now.

unsafe fn encode_frame(
    codec_ctx: *mut AVCodecContext,
    sws: *mut SwsContext,
    yuv_frame: *mut AVFrame,
    pkt: *mut AVPacket,
    crop_h: i32,
    crop_x: i32,
    crop_y: i32,
    _dst_h: i32,
    dst_x: i32,
    dst_y: i32,
    raw: &Arc<RawFrame>,
    frame_count: &mut u64,
    bytes_since_status: &mut u64,
    pts: &mut i64,
    sws_ms_acc: &mut f64,
    nvenc_ms_acc: &mut f64,
    recv_ms_acc: &mut f64,
    pkt_tx: &std::sync::mpsc::SyncSender<OwnedPacket>,
    codec_tb: AVRational,
    stream_tb: AVRational,
    stream_index: i32,
    pkts_dropped: &mut u64,
    queue_depth: &AtomicI32,
) -> Result<()> {
    let t0 = Instant::now();

    let start_offset = (crop_y * raw.width as i32 + crop_x) * 4;
    let src_data: [*const u8; 4] = [
        raw.pixels.as_ptr().add(start_offset as usize),
        ptr::null(), ptr::null(), ptr::null()
    ];
    let src_stride: [i32; 4] = [raw.width as i32 * 4, 0, 0, 0];

    let dst_offset_y = dst_y * (*yuv_frame).linesize[0] + dst_x;
    let dst_offset_u = (dst_y / 2) * (*yuv_frame).linesize[1] + (dst_x / 2);
    let dst_offset_v = (dst_y / 2) * (*yuv_frame).linesize[2] + (dst_x / 2);

    let mut dst_data: [*mut u8; 4] = [
        (*yuv_frame).data[0].add(dst_offset_y as usize),
        (*yuv_frame).data[1].add(dst_offset_u as usize),
        (*yuv_frame).data[2].add(dst_offset_v as usize),
        ptr::null_mut()
    ];

    sws_scale(
        sws,
        src_data.as_ptr(),
        src_stride.as_ptr(),
        0, crop_h,
        dst_data.as_mut_ptr(),
        (*yuv_frame).linesize.as_ptr(),
    );

    let t1 = Instant::now();

    (*yuv_frame).pts = *pts;
    *pts += 1;

    check(avcodec_send_frame(codec_ctx, yuv_frame), "avcodec_send_frame")?;

    let t2 = Instant::now();

    let mut recv_ms: f64 = 0.0;

    loop {
        let ta = Instant::now();
        let ret = avcodec_receive_packet(codec_ctx, pkt);
        recv_ms += ta.elapsed().as_secs_f64() * 1000.0;

        if ret == AVERROR(EAGAIN) || ret == AVERROR_EOF { break; }
        check(ret, "avcodec_receive_packet")?;

        let pkt_size = (*pkt).size as u64;

        // Move encoded data into a new packet for the RTMP thread.
        let new_pkt = av_packet_alloc();
        av_packet_move_ref(new_pkt, pkt);
        // pkt is now blank; avcodec_receive_packet will repopulate it next iteration.

        av_packet_rescale_ts(new_pkt, codec_tb, stream_tb);
        (*new_pkt).stream_index = stream_index;

        // Non-blocking send. If queue is full, OwnedPacket drops and frees new_pkt.
        if pkt_tx.try_send(OwnedPacket(new_pkt)).is_ok() {
            queue_depth.fetch_add(1, Ordering::Relaxed);
            *bytes_since_status += pkt_size;
            *frame_count += 1;
        } else {
            *pkts_dropped += 1;
        }
    }

    *sws_ms_acc   += (t1 - t0).as_secs_f64() * 1000.0;
    *nvenc_ms_acc += (t2 - t1).as_secs_f64() * 1000.0;
    *recv_ms_acc  += recv_ms;

    Ok(())
}

// ── Helpers ───────────────────────────────────────────────────────────────────

fn check(ret: i32, op: &str) -> Result<()> {
    if ret < 0 {
        Err(anyhow!("{op} failed (ffmpeg error {ret})"))
    } else {
        Ok(())
    }
}

unsafe fn set_opt(ctx: *mut AVCodecContext, key: &str, val: &str) {
    if let (Ok(k), Ok(v)) = (CString::new(key), CString::new(val)) {
        let ret = av_opt_set((*ctx).priv_data, k.as_ptr(), v.as_ptr(), 0);
        if ret < 0 {
            tracing::warn!("av_opt_set({key}={val}) ignored ({})", ret);
        }
    }
}
