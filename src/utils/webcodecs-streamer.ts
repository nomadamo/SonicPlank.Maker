// WebCodecs-based H.264 streamer (Phase 1 GPU-offload pipeline).
//
// Replaces the canvas → JPEG → FFmpeg-transcode path. The compositor canvas is
// fed straight into a hardware-accelerated VideoEncoder, which runs on a
// Chromium media thread (NOT the JS main thread), so the editor UI stays smooth.
// The encoder emits Annex-B H.264 chunks that FFmpeg muxes to FLV with `-c copy`
// — no intermediate lossy codec, no re-encode.

export interface H264EncoderConfig {
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  /** Called for every encoded chunk (Annex-B NAL units) — pipe straight to FFmpeg. */
  onChunk: (data: ArrayBuffer) => void;
  onError?: (err: Error) => void;
}

export interface H264EncoderHandle {
  /** Encode one canvas frame. Handles keyframe cadence, backpressure and frame disposal. */
  encodeCanvas: (
    canvas: HTMLCanvasElement | OffscreenCanvas,
    frameIndex: number,
    forceKeyframe?: boolean,
  ) => void;
  /** Flush and release the encoder. */
  close: () => Promise<void>;
  /** The negotiated codec string (for logging). */
  codec: string;
}

// High-profile candidates, highest level first so we keep headroom for 1080p60/4K.
// Falls back to baseline if the GPU encoder is picky.
const CODEC_CANDIDATES = [
  "avc1.640033", // High 5.1
  "avc1.64002A", // High 4.2
  "avc1.640028", // High 4.0
  "avc1.42E01F", // Baseline 3.1
];

function buildConfig(
  codec: string,
  cfg: H264EncoderConfig,
): VideoEncoderConfig {
  return {
    codec,
    width: cfg.width,
    height: cfg.height,
    bitrate: cfg.bitrateKbps * 1000,
    framerate: cfg.fps,
    hardwareAcceleration: "prefer-hardware",
    latencyMode: "realtime",
    bitrateMode: "constant",
    // Annex-B so SPS/PPS + start codes are in-band — FFmpeg `-f h264` can parse
    // the raw pipe with no container or extradata.
    avc: { format: "annexb" },
  } as VideoEncoderConfig;
}

/** Probe whether any hardware-capable H.264 config is supported for these dimensions. */
export async function pickSupportedCodec(
  cfg: H264EncoderConfig,
): Promise<string | null> {
  if (typeof VideoEncoder === "undefined") return null;
  for (const codec of CODEC_CANDIDATES) {
    try {
      const support = await VideoEncoder.isConfigSupported(
        buildConfig(codec, cfg),
      );
      if (support.supported) {
        const ext = support as VideoEncoderSupport & { powerEfficient?: boolean };
        const hw = support.config?.hardwareAcceleration ?? "unknown";
        const pe = String(ext.powerEfficient ?? "unknown");
        console.log(
          `[webcodecs-streamer] codec selected: ${support.config?.codec ?? codec} | hardwareAcceleration=${hw} | powerEfficient=${pe}`,
        );
        return support.config?.codec || codec;
      }
    } catch {
      // try next candidate
    }
  }
  console.warn("[webcodecs-streamer] no supported H.264 codec — VideoEncoder unavailable");
  return null;
}

/**
 * Create and configure a canvas-fed H.264 encoder. Returns null if WebCodecs
 * H.264 encoding is unavailable, so callers can fall back to the legacy path.
 */
export async function createH264CanvasEncoder(
  cfg: H264EncoderConfig,
): Promise<H264EncoderHandle | null> {
  const codec = await pickSupportedCodec(cfg);
  if (!codec) return null;

  const encoder = new VideoEncoder({
    output: (chunk) => {
      const buffer = new ArrayBuffer(chunk.byteLength);
      chunk.copyTo(buffer);
      cfg.onChunk(buffer);
    },
    error: (err) => {
      console.error("[webcodecs-streamer] encoder error:", err);
      cfg.onError?.(err);
    },
  });

  encoder.configure(buildConfig(codec, cfg));

  // Force a fixed GOP (keyframe every 2s) — RTMP ingest (YouTube/Twitch)
  // requires a fixed keyframe interval; letting the encoder pick scene-cut
  // keyframes breaks their segmenting.
  const keyFrameInterval = Math.max(1, Math.round(cfg.fps * 2));

  // Wall-clock origin for PTS. Using frame-count × frameDuration would cause
  // timestamps to drift ahead of real time whenever the compositor runs below
  // the nominal fps (e.g. heavy overlay drawing) — FFmpeg would buffer those
  // "future" timestamps and produce a steadily growing stream delay.
  const startTime = performance.now();

  // Lightweight diagnostics: count dropped (backpressured) frames and log the
  // encoder queue depth periodically so a degrading pipeline is visible.
  let dropped = 0;
  let submitted = 0;

  return {
    codec,
    encodeCanvas(canvas, frameIndex, forceKeyframe) {
      if (encoder.state !== "configured") return;
      // Backpressure: if the encoder is falling behind, drop this frame rather
      // than queue unbounded VideoFrames (which would leak GPU memory).
      if (encoder.encodeQueueSize > 2) {
        dropped++;
        return;
      }

      // Timestamps in microseconds, anchored to wall-clock time so they stay
      // in sync with reality even when the compositor runs below nominal fps.
      const timestamp = Math.round((performance.now() - startTime) * 1000);
      const frame = new VideoFrame(canvas, { timestamp });
      try {
        encoder.encode(frame, {
          keyFrame: !!forceKeyframe || frameIndex % keyFrameInterval === 0,
        });
        submitted++;
      } finally {
        frame.close();
      }

      if (frameIndex > 0 && frameIndex % (cfg.fps * 5) === 0) {
        console.log(
          `[webcodecs-streamer] frames: ${submitted} submitted, ${dropped} dropped, queue=${encoder.encodeQueueSize}`,
        );
      }
    },
    async close() {
      try {
        if (encoder.state === "configured") await encoder.flush();
      } catch {
        // flush can reject if already errored — ignore
      }
      try {
        if (encoder.state !== "closed") encoder.close();
      } catch {
        // ignore
      }
    },
  };
}
