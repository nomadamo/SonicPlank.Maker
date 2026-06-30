import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  globalShortcut,
  ipcMain,
  MessageChannelMain,
  session,
  screen,
  shell,
} from "electron";
import {
  readData,
  writeData,
  readLibrary,
  writeLibrary,
  readTimeline,
  writeTimeline,
} from "./utils/fileOperations";
import getAudioData from "./utils/get-audio-data";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import net from "node:net";
import http from "node:http";
import readline from "node:readline";
import {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_REDIRECT_URI,
  SPOTIFY_SCOPES,
} from "./constants/audio";
import started from "electron-squirrel-startup";
import { inDevelopment } from "./constants";
import { spawn } from "node:child_process";
import AdmZip from "adm-zip";
import type { EventSubWsListener } from "@twurple/eventsub-ws";
import { startApiServer, stopApiServer, updateApiState, broadcastWsEvent } from "./api-server";
import { refreshYoutubeAccessToken, uploadVideoToYoutube } from "./youtube-upload";

// ── GPU / capture acceleration ───────────────────────────────────────────────
// All enable-features flags MUST be in a single appendSwitch call.
// Multiple calls don't accumulate — each replaces the previous value.
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-native-gpu-memory-buffers");
app.commandLine.appendSwitch("enable-accelerated-video-decode");
app.commandLine.appendSwitch("enable-accelerated-video-encode");
// Override Chromium's GPU driver blocklist — many common driver versions are
// blocklisted as a precaution and cause WebCodecs/canvas GPU paths to silently
// fall back to software even when the hardware is perfectly capable.
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("disable-gpu-driver-bug-workarounds");
app.commandLine.appendSwitch(
  "enable-features",
  [
    // Move canvas 2D rasterization to a GPU worker so VideoFrame(canvas)
    // becomes a GPU-to-GPU texture copy instead of a CPU upload.
    "CanvasOopRasterization",
    // Zero-copy Windows Graphics Capture: the captured D3D11 texture is shared
    // directly to the video element — eliminates one CPU copy per captured frame.
    "D3D11ZeroCopyVideoCapture",
    // Use the D3D11 hardware video decoder for the captured stream.
    "D3D11VideoDecoder",
  ].join(","),
);
// Explicit D3D11 backend — more reliable than "default" on Windows.
app.commandLine.appendSwitch("use-angle", "d3d11");
// Don't throttle the renderer when the window loses focus (needed for streaming
// while the user is looking at another app).
app.commandLine.appendSwitch("disable-renderer-backgrounding");
// Allow the capture subsystem to use up to 75% of a core when needed.
app.commandLine.appendSwitch("webrtc-max-cpu-consumption-percentage", "75");

let ffmpegProcess: any = null;
let activeOverlays: any[] = [];
const cachedChatMessages = new Map<string, any[]>();
const twitchListeners = new Map<string, EventSubWsListener>();
let previewWin: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let overlayConfigWidth = 1920;
let overlayConfigHeight = 1080;
let overlayStreamFps = 30;
let overlayThrottleMs = 100;
let overlayFpsRestoreTimeout: ReturnType<typeof setTimeout> | null = null;

function bumpOverlayFrameRateForTransition(durationMs: number): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (overlayFpsRestoreTimeout) clearTimeout(overlayFpsRestoreTimeout);
  overlayWindow.webContents.setFrameRate(overlayStreamFps);
  overlayThrottleMs = Math.round(1000 / overlayStreamFps);
  overlayFpsRestoreTimeout = setTimeout(() => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.setFrameRate(10);
    }
    overlayThrottleMs = 100;
    overlayFpsRestoreTimeout = null;
  }, durationMs * 2 + 500);
}

// ── Overlay shared memory (SHM) ──────────────────────────────────────────────
// Electron writes BGRA overlay pixels directly into a page-file-backed section
// created by the Rust core. The compositor reads them via a seqlock, eliminating
// kernel pipe transitions and the per-frame mutex lock on the Rust side.
//
// Layout: [u32 gen][u32 width][u32 height][BGRA pixels...]
//   gen == 0   → no frame yet
//   gen is odd → write in progress, Rust skips
//   gen is even → frame is consistent, Rust reads

let _shmViewPtr: any = null;   // void* from MapViewOfFile (koffi opaque pointer)
let _shmWriteBuf: Buffer | null = null;  // preallocated staging buffer (reused every frame)
let _shmMemcpy: any = null;    // koffi memcpy binding
let _shmGenCounter = 1;        // seqlock generation: odd=writing, even=done

const _FILE_MAP_WRITE = 0x0002;

function connectShmOverlay(shmName: string, shmSize: number): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const koffi = require("koffi") as any;
    const kernel32 = koffi.load("kernel32.dll");
    const OpenFileMappingW = kernel32.func(
      "void * __stdcall OpenFileMappingW(uint32, bool, str16)",
    );
    const MapViewOfFile = kernel32.func(
      "void * __stdcall MapViewOfFile(void *, uint32, uint32, uint32, size_t)",
    );
    const msvcrt = koffi.load("msvcrt.dll");
    _shmMemcpy = msvcrt.func("void * __cdecl memcpy(void *, void *, size_t)");

    const handle = OpenFileMappingW(_FILE_MAP_WRITE, false, shmName);
    if (!handle) {
      console.error("[SHM] OpenFileMappingW failed for:", shmName);
      return;
    }

    _shmViewPtr = MapViewOfFile(handle, _FILE_MAP_WRITE, 0, 0, 0);
    if (!_shmViewPtr) {
      console.error("[SHM] MapViewOfFile failed");
      return;
    }

    _shmWriteBuf = Buffer.allocUnsafe(shmSize);
    console.log(`[SHM] overlay mapped: ${shmName} (${shmSize} bytes)`);
  } catch (err) {
    console.error("[SHM] Failed to connect overlay shm:", err);
  }
}

function writeOverlayToShm(bgra: Buffer, width: number, height: number): void {
  if (!_shmViewPtr || !_shmWriteBuf || !_shmMemcpy) return;
  const pixelLen = width * height * 4;
  if (12 + pixelLen > _shmWriteBuf.length) return;

  const oddGen = _shmGenCounter;
  const evenGen = _shmGenCounter + 1;

  // Build staging buffer: [gen_odd(4)][width(4)][height(4)][BGRA pixels]
  _shmWriteBuf.writeUInt32LE(oddGen, 0);
  _shmWriteBuf.writeUInt32LE(width, 4);
  _shmWriteBuf.writeUInt32LE(height, 8);
  bgra.copy(_shmWriteBuf, 12, 0, pixelLen);

  // Write header + pixels to shm (gen_odd at offset 0 written first)
  _shmMemcpy(_shmViewPtr, _shmWriteBuf, 12 + pixelLen);

  // Seal: write even gen to offset 0 — Rust seqlock sees consistent data
  _shmWriteBuf.writeUInt32LE(evenGen, 0);
  _shmMemcpy(_shmViewPtr, _shmWriteBuf, 4);

  _shmGenCounter += 2;
  if (_shmGenCounter > 0x7fff_fffe) _shmGenCounter = 1; // prevent overflow
}

async function ensureOverlayWindow(): Promise<void> {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    overlayWindow = new BrowserWindow({
      width: overlayConfigWidth,
      height: overlayConfigHeight,
      transparent: true,
      frame: false,
      show: false,
      skipTaskbar: true,
      webPreferences: {
        offscreen: true,
        devTools: inDevelopment,
        preload: path.join(__dirname, "preload.js"),
        webSecurity: false,
        backgroundThrottling: false,
      },
    });

    // Limit repaint rate --- 1080p BGRA is ~8 MB/frame; 10fps keeps pipe pressure manageable.
    overlayWindow.webContents.setFrameRate(10);

    // Gate SHM writes until the overlay route has fully loaded to prevent the Electron
    // loading animation from leaking into the stream as the first composited frame.
    let overlayWindowReady = false;
    overlayWindow.webContents.once("did-finish-load", () => {
      overlayWindowReady = true;
    });

    // Forward each paint as an overlay frame written directly into shared memory.
    // Belt-and-suspenders JS throttle in case Chromium fires events faster than setFrameRate.
    let lastOverlaySendMs = 0;
    overlayWindow.webContents.on("paint", (_event, _dirty, image) => {
      if (!_shmViewPtr || !overlayWindowReady) return;
      const now = Date.now();
      if (now - lastOverlaySendMs < overlayThrottleMs) return; // dynamic fps; bail before toBitmap()
      lastOverlaySendMs = now;

      const size = image.getSize();
      const bgra = image.toBitmap();
      const w = size.width;
      const h = size.height;
      if (bgra.length !== w * h * 4) return;

      writeOverlayToShm(bgra, w, h);
    });

    if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
      void overlayWindow.loadURL(
        MAIN_WINDOW_VITE_DEV_SERVER_URL + "/#/overlay",
      );
    } else {
      void overlayWindow.loadFile(
        path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
        { hash: "overlay" },
      );
    }
  }
}

// Stream delay buffer. When streamDelayMs > 0, encoded H.264 chunks are held
// here before being written to FFmpeg stdin. Each entry records wall-clock
// receipt time so frames are released at the right moment.
let streamDelayMs = 0;
const streamDelayBuffer: { data: Buffer; receivedAt: number }[] = [];
let streamDelayTimer: ReturnType<typeof setInterval> | null = null;

function startDelayFlush() {
  if (streamDelayTimer) return;
  streamDelayTimer = setInterval(() => {
    const now = Date.now();
    const stdin = getStdin();
    while (
      streamDelayBuffer.length > 0 &&
      now - streamDelayBuffer[0].receivedAt >= streamDelayMs
    ) {
      const frame = streamDelayBuffer.shift();
      if (frame && stdin) {
        try {
          stdin.write(frame.data);
        } catch (writeErr) {
          console.error("Delay buffer write error:", writeErr);
        }
      }
    }
  }, 16); // tick every ~1 frame at 60fps
}

function stopDelayFlush(flushRemaining = true) {
  if (streamDelayTimer) {
    clearInterval(streamDelayTimer);
    streamDelayTimer = null;
  }
  if (flushRemaining) {
    const stdin = getStdin();
    for (const frame of streamDelayBuffer) {
      if (stdin) {
        try {
          stdin.write(frame.data);
        } catch (flushErr) {
          console.error("Delay buffer flush error:", flushErr);
        }
      }
    }
  }
  streamDelayBuffer.length = 0;
}

function getStdin(): NodeJS.WritableStream | null {
  const proc = ffmpegProcess as { stdin?: NodeJS.WritableStream } | null;
  return proc?.stdin?.writable ? proc.stdin : null;
}

// ── Native core process ──────────────────────────────────────────────────────

const CORE_BINARY_EXT = process.platform === "win32" ? ".exe" : "";

let coreProcess: ReturnType<typeof spawn> | null = null;
// Data pipe --- carries binary frame data (Phase 1+). Read-only from Electron's
// perspective; commands go to stdin, events come from stdout.
let coreDataSocket: net.Socket | null = null;
let coreKeepAliveTimer: ReturnType<typeof setInterval> | null = null;
let coreLastAckMs = 0;

// One-shot listeners keyed by event type. waitForCoreEvent() registers here;
// the persistent stdout readline fires them as events arrive.
interface CoreEventListener {
  type: string;
  predicate?: (ev: Record<string, unknown>) => boolean;
  resolve: (ev: Record<string, unknown>) => void;
  reject: (err: Error) => void;
}
const coreEventListeners = new Set<CoreEventListener>();
let coreStdoutRl: readline.Interface | null = null;

// Accumulates partial binary frames arriving from the data pipe.
let coreFrameBuffer = Buffer.alloc(0);

let captureRefCount = 0; // Deprecated, remove later
let activeCaptures = new Map<string, number>();
let activeStreamSources: { source_id: string }[] = [];
let activeCaptureSourceId: string | null = null;
let nativeStreamStartAt: number | null = null;
let activeStreamOutWidth = 1920;
let activeStreamOutHeight = 1080;
let nativePreviewActive = false;

// VOD tracking state — set at stream start, consumed at stream stop.
let activeRecordFilePath: string | null = null;
let activeStreamRtmpUrl: string | null = null;
let activeStreamTwitchToken: string | null = null;
let activeStreamTwitchUserId: string | null = null;
let activeStreamTwitchClientId: string | null = null;
let activeStreamYoutubeClientId: string | null = null;
let activeStreamYoutubeClientSecret: string | null = null;
let activeStreamYoutubeRefreshToken: string | null = null;
let activeStreamYoutubeAutoUpload = false;

// Viewer count polling
let viewerCountIntervalId: ReturnType<typeof setInterval> | null = null;

// Set up a persistent readline on core stdout. Must be called after coreProcess
// is assigned. Subsequent calls are no-ops (already started guard).
function startCoreEventLoop(): void {
  if (!coreProcess?.stdout || coreStdoutRl) return;
  coreStdoutRl = readline.createInterface({ input: coreProcess.stdout });
  coreStdoutRl.on("line", (line) => {
    try {
      const ev = JSON.parse(line) as Record<string, unknown>;
      const type = ev.type as string | undefined;
      if (!type) return;
      if (type === "acknowledge") {
        coreLastAckMs = Date.now();
        return;
      }
      // audio_level fires at ~100ms intervals during streaming — broadcast to all windows.
      if (type === "audio_level") {
        const peakDb = (ev.peak_db as number) ?? -Infinity;
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) win.webContents.send("onAudioLevel", peakDb);
        });
        return;
      }
      // stream_status fires repeatedly --- broadcast directly rather than consuming a one-shot listener.
      if (type === "stream_status") {
        const frame = (ev.frame as number) ?? 0;
        const fps = (ev.fps as number) ?? 0;
        const bitrateKbps = (ev.bitrate_kbps as number) ?? 0;
        const dropped = (ev.dropped as number) ?? 0;
        const totalSec =
          nativeStreamStartAt != null
            ? Math.floor((Date.now() - nativeStreamStartAt) / 1000)
            : 0;
        const hh = String(Math.floor(totalSec / 3600)).padStart(2, "0");
        const mm = String(Math.floor((totalSec % 3600) / 60)).padStart(2, "0");
        const ss = String(totalSec % 60).padStart(2, "0");
        const stats = {
          frame,
          fps,
          bitrate:
            bitrateKbps >= 1000
              ? `${(bitrateKbps / 1000).toFixed(1)} Mbps`
              : `${bitrateKbps} kbps`,
          time: `${hh}:${mm}:${ss}`,
          size: null,
          speed: null,
          dropped,
        };
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) win.webContents.send("onStreamStatus", stats);
        });
        return;
      }
      
      let matched = false;
      for (const listener of coreEventListeners) {
        if (listener.type === type) {
          if (!listener.predicate || listener.predicate(ev)) {
            listener.resolve(ev);
            coreEventListeners.delete(listener);
            matched = true;
          }
        }
      }

      // If there's an error event, reject all waiting promises that aren't specifically waiting for "error"
      if (type === "error") {
        console.error("[Core] Emitted error:", ev);
        for (const listener of coreEventListeners) {
          if (listener.type !== "error") {
            // Pass the error event so the listener can reject
            listener.reject(new Error(`[Core] Error: ${ev.message || "Unknown error"}`));
            coreEventListeners.delete(listener);
          }
        }
      }
    } catch {
      console.warn("[Core] unparseable stdout line:", line);
    }
  });
  coreStdoutRl.on("close", () => {
    coreStdoutRl = null;
  });
}

// Return a promise that resolves when core emits the given event type.
function waitForCoreEvent<T extends Record<string, unknown>>(
  type: string,
  timeoutMs = 5000,
  predicate?: (ev: Record<string, unknown>) => boolean
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const listener: CoreEventListener = {
      type,
      predicate,
      resolve: resolve as (ev: Record<string, unknown>) => void,
      reject,
    };
    
    const tid = setTimeout(() => {
      coreEventListeners.delete(listener);
      reject(new Error(`[Core] timeout waiting for '${type}' event`));
    }, timeoutMs);
    
    // Wrap resolve/reject to also clear the timeout
    const originalResolve = listener.resolve;
    const originalReject = listener.reject;
    
    listener.resolve = (ev) => {
      clearTimeout(tid);
      originalResolve(ev);
    };
    
    listener.reject = (err) => {
      clearTimeout(tid);
      originalReject(err);
    };

    coreEventListeners.add(listener);
  });
}

// Parse accumulated binary frames from the data pipe. The data pipe is
// preview-only --- streaming is handled entirely inside the Rust core.
function parseDataPipeFrame(chunk: Buffer): void {
  coreFrameBuffer = Buffer.concat([coreFrameBuffer, chunk]);

  while (coreFrameBuffer.length >= 8) {
    const frameType = coreFrameBuffer.readUInt32LE(0);
    const payloadLen = coreFrameBuffer.readUInt32LE(4);
    const totalLen = 8 + payloadLen;

    if (coreFrameBuffer.length < totalLen) break;

    // frameType 1 = VideoPreview: [u8 source_id_len] [source_id_bytes] [u32 width] [u32 height] [RGBA pixels]
    if (frameType === 1 && payloadLen >= 9) {
      const sourceIdLen = coreFrameBuffer.readUInt8(8);
      if (payloadLen >= 9 + sourceIdLen + 8) {
        const sourceId = coreFrameBuffer
          .subarray(9, 9 + sourceIdLen)
          .toString("utf8");
        const width = coreFrameBuffer.readUInt32LE(9 + sourceIdLen);
        const height = coreFrameBuffer.readUInt32LE(13 + sourceIdLen);
        const pixelBytes = width * height * 4;
        if (17 + sourceIdLen + pixelBytes <= totalLen && nativePreviewActive) {
          const pixels = coreFrameBuffer.subarray(
            17 + sourceIdLen,
            17 + sourceIdLen + pixelBytes,
          );
          BrowserWindow.getAllWindows().forEach((win) => {
            if (!win.isDestroyed()) {
              win.webContents.send(
                "onNativePreviewFrame",
                sourceId,
                width,
                height,
                pixels,
              );
            }
          });
        }
      }
    }

    coreFrameBuffer = Buffer.from(coreFrameBuffer.subarray(totalLen));
  }
}

function resolveCoreBinary(): string {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      `sonicplank-core${CORE_BINARY_EXT}`,
    );
  }
  // Dev: __dirname is .vite/build/ at runtime — step up to project root.
  return path.resolve(
    __dirname,
    `../../src-native/target/debug/sonicplank-core${CORE_BINARY_EXT}`,
  );
}

// Wait for the Ready event on stdout and return the negotiated pipe name.
// Also starts the persistent event loop so subsequent events are dispatched.
async function waitForCoreReady(): Promise<string> {
  if (!coreProcess?.stdout) {
    throw new Error("Core process has no stdout");
  }
  startCoreEventLoop();

  const ev = await waitForCoreEvent<{
    pipe?: string;
    version?: string;
    pid?: number;
    shm_name?: string;
    shm_size?: number;
  }>("ready", 10_000);
  const pipe = ev.pipe;
  if (!pipe) {
    throw new Error("Ready event missing pipe field");
  }
  console.log(
    `[Core] ready - version=${ev.version ?? "?"} pid=${ev.pid ?? "?"} pipe=${pipe}`,
  );

  // Map the overlay shared memory section that the Rust core just created.
  if (ev.shm_name && ev.shm_size) {
    connectShmOverlay(ev.shm_name, ev.shm_size);
  }

  return pipe;
}

// Connect to the negotiated data pipe and send Hello to authenticate.
function connectDataPipe(pipeName: string, token: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const socket = net.createConnection({ path: pipeName });

    socket.once("connect", () => {
      // Hello must be the first message — core verifies the token before
      // accepting any frame data.
      socket.write(JSON.stringify({ type: "hello", token }) + "\n");
      coreDataSocket = socket;
      console.log("[Core] data pipe connected and Hello sent");
      resolve();
    });

    socket.once("error", (err) => {
      console.error("[Core] data pipe connection error:", err);
      reject(err);
    });

    socket.on("data", (data: Buffer) => {
      parseDataPipeFrame(data);
    });

    socket.on("close", () => {
      console.log("[Core] data pipe closed");
      coreDataSocket = null;
    });
  });
}

async function startCore(): Promise<void> {
  const binary = resolveCoreBinary();
  if (!fs.existsSync(binary)) {
    console.warn(`[Core] binary not found at ${binary} --- skipping`);
    return;
  }

  // Generate per-launch secrets. Token authenticates the data pipe connection;
  // pipeId randomises the pipe name to prevent squatting.
  const token = crypto.randomBytes(32).toString("base64url");
  const pipeId = crypto.randomBytes(16).toString("hex");

  const spawnEnv = { ...process.env };
  if (!app.isPackaged) {
    // In dev, prepend the FFmpeg bin dir to PATH so the debug binary can
    // find the shared DLLs. Read FFMPEG_DIR from .cargo/config.toml so this
    // stays in sync when the FFmpeg version is bumped.
    try {
      const cargoConfigPath = path.resolve(
        __dirname,
        "../../src-native/.cargo/config.toml",
      );
      const cargoConfig = fs.readFileSync(cargoConfigPath, "utf-8");
      const match = cargoConfig.match(/FFMPEG_DIR\s*=\s*\{\s*value\s*=\s*"([^"]+)"/);
      if (match?.[1]) {
        const ffmpegDir = JSON.parse(`"${match[1]}"`);
        const ffmpegBin = path.join(ffmpegDir, "bin");
        spawnEnv.PATH = `${ffmpegBin};${spawnEnv.PATH ?? ""}`;
        console.log(`[Core] dev DLL path: ${ffmpegBin}`);
      }
    } catch (err) {
      console.warn("[Core] could not read FFMPEG_DIR from config.toml:", err);
    }
  }

  const coreArgs: string[] = [];
  if (app.commandLine.hasSwitch("verbose") || !app.isPackaged) {
    coreArgs.push("--verbose");
  }

  coreProcess = spawn(binary, coreArgs, {
    stdio: ["pipe", "pipe", "pipe"],
    env: spawnEnv,
  });

  coreProcess.stderr?.on("data", (data: Buffer) => {
    for (const line of data.toString().split("\n")) {
      if (line.trim()) console.log(`[core] ${line}`);
    }
  });

  coreProcess.on("error", (err: Error) =>
    console.error("[Core] spawn error:", err),
  );
  coreProcess.on("exit", (code: number | null, signal: string | null) => {
    console.log(
      `[Core] exited: code=${code ?? "null"} signal=${signal ?? "null"}`,
    );
    coreProcess = null;
    coreDataSocket = null;
  });

  // Write Auth immediately — core blocks on stdin until it receives this.
  coreProcess.stdin?.write(
    JSON.stringify({ type: "auth", token, pipe_id: pipeId }) + "\n",
  );

  try {
    const pipeName = await waitForCoreReady();
    await connectDataPipe(pipeName, token);
    startCoreKeepAlive();
  } catch (err) {
    console.error("[Core] startup failed:", err);
  }
}

function startCoreKeepAlive() {
  if (coreKeepAliveTimer) return;
  coreLastAckMs = Date.now();
  coreKeepAliveTimer = setInterval(() => {
    if (!coreProcess) return;

    sendCoreCommand({ type: "standby" });

    if (Date.now() - coreLastAckMs > 35000) {
      console.warn("[Core] Missed keep-alive ACKs for 35s. Restarting core...");
      stopCore();
      setTimeout(() => startCore().catch(console.error), 1000);
    }
  }, 10000);
}

// Send a command on the control plane (stdin). Commands never go over the data pipe.
function sendCoreCommand(cmd: Record<string, unknown>): void {
  if (!coreProcess?.stdin?.writable) {
    console.warn("[Core] stdin not writable --- command dropped:", cmd);
    return;
  }
  coreProcess.stdin.write(JSON.stringify(cmd) + "\n", (err) => {
    if (err) console.warn("[Core] stdin write error:", err.message);
  });
}

function stopCore(): void {
  if (coreKeepAliveTimer) {
    clearInterval(coreKeepAliveTimer);
    coreKeepAliveTimer = null;
  }
  if (!coreProcess) return;
  // Signal Rust to start graceful shutdown
  sendCoreCommand({ type: "exit" });
  coreProcess.stdin?.end();

  if (coreDataSocket) {
    coreDataSocket.destroy();
    coreDataSocket = null;
  }
  // Do NOT null coreProcess here --- will-quit uses it as a backstop kill.
  // The process exit event clears coreProcess once it actually terminates.
}

// Themes directory settings
const themesDir = path.join(
  app.getPath("appData"),
  "SonicPlank.Maker",
  "Themes",
);

// Overlay themes directory (separate from UI color themes)
const overlayThemesDir = path.join(
  app.getPath("appData"),
  "SonicPlank.Maker",
  "OverlayThemes",
);

function ensureOverlayThemesDir() {
  if (!fs.existsSync(overlayThemesDir)) {
    fs.mkdirSync(overlayThemesDir, { recursive: true });
  }
}

function ensureThemesDir() {
  if (!fs.existsSync(themesDir)) {
    fs.mkdirSync(themesDir, { recursive: true });
  }

  const defaultThemeDir = path.join(themesDir, "default");
  if (!fs.existsSync(defaultThemeDir)) {
    try {
      fs.mkdirSync(defaultThemeDir, { recursive: true });
      const themeJson = {
        name: "Default Theme",
        author: "SonicPlank",
        description: "Default standard preview styling container",
        accentColor: "#6366f1",
      };
      fs.writeFileSync(
        path.join(defaultThemeDir, "theme.json"),
        JSON.stringify(themeJson, null, 2),
      );

      const themeCss = `/* Default Theme CSS Variables */
:root {
  --preview-accent: #6366f1;
  --preview-accent-rgb: 99, 102, 241;
  --preview-accent-glow: 0 0 15px rgba(99, 102, 241, 0.4);
}`;
      fs.writeFileSync(path.join(defaultThemeDir, "theme.css"), themeCss);
    } catch (err) {
      console.error("Failed to create default theme directories:", err);
    }
  }
}

// Handle squirrel startup checks
if (started) {
  app.quit();
}

let forceClose = false;

// ── VOD tracking helpers ──────────────────────────────────────────────────────

function detectStreamPlatform(rtmpUrl: string): "twitch" | "youtube" | "custom" {
  const u = rtmpUrl.toLowerCase();
  if (u.includes("twitch.tv") || u.includes("twitchapps.com") || u.includes("live.twitch.tv")) return "twitch";
  if (u.includes("youtube.com") || u.includes("googlevideo.com")) return "youtube";
  return "custom";
}

type VodStatusPayload =
  | { phase: "recording_saved"; platform: string; filePath: string }
  | { phase: "searching";       platform: string; filePath: string }
  | { phase: "uploading";       platform: string; filePath: string; progress: number }
  | { phase: "found";           platform: string; filePath: string; vodUrl: string }
  | { phase: "not_found";       platform: string; filePath: string }
  | { phase: "error";           platform: string; filePath: string; message: string };

async function pollViewerCount(): Promise<void> {
  if (!activeStreamTwitchToken || !activeStreamTwitchUserId || !activeStreamTwitchClientId) return;
  try {
    const rawToken = activeStreamTwitchToken.replace(/^oauth:/i, "");
    const res = await fetch(
      `https://api.twitch.tv/helix/streams?user_id=${activeStreamTwitchUserId}`,
      { headers: { "Client-ID": activeStreamTwitchClientId, Authorization: `Bearer ${rawToken}` } },
    );
    if (!res.ok) return;
    const data = (await res.json()) as { data?: { viewer_count: number }[] };
    const count = data.data?.[0]?.viewer_count ?? 0;
    updateApiState({ viewerCount: count });
    broadcastWsEvent("streamState", { streaming: true, viewerCount: count });
  } catch { /* ignore — stream may have just stopped */ }
}

async function createTwitchClipApi(): Promise<string | null> {
  if (!activeStreamTwitchToken || !activeStreamTwitchUserId || !activeStreamTwitchClientId) return null;
  try {
    const rawToken = activeStreamTwitchToken.replace(/^oauth:/i, "");
    const res = await fetch(
      `https://api.twitch.tv/helix/clips?broadcaster_id=${activeStreamTwitchUserId}`,
      {
        method: "POST",
        headers: { "Client-ID": activeStreamTwitchClientId, Authorization: `Bearer ${rawToken}` },
      },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { data?: { id: string }[] };
    const id = data.data?.[0]?.id;
    return id ? `https://clips.twitch.tv/${id}` : null;
  } catch { return null; }
}

function broadcastVodStatus(status: VodStatusPayload) {
  broadcastSafe("onVodStatus", status);
}

async function pollTwitchVod(
  userId: string,
  clientId: string,
  token: string,
  streamStopTime: number,
): Promise<string | null> {
  const deadline = streamStopTime + 20 * 60 * 1000; // 20-minute window (Twitch processing takes 5-15 min)
  const windowStart = streamStopTime - 2 * 60 * 1000;
  while (Date.now() < deadline) {
    await new Promise<void>((r) => setTimeout(r, 15_000));
    try {
      const res = await fetch(
        `https://api.twitch.tv/helix/videos?user_id=${userId}&type=archive&first=1`,
        { headers: { "Client-Id": clientId, Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as { data: { id: string; created_at: string }[] };
      const video = json.data[0];
      if (video && new Date(video.created_at).getTime() >= windowStart) {
        return `https://www.twitch.tv/videos/${video.id}`;
      }
    } catch {
      // keep polling
    }
  }
  return null;
}

function safeSend(win: Electron.BrowserWindow, channel: string, ...args: unknown[]): void {
  try {
    if (!win.isDestroyed()) win.webContents.send(channel, ...args);
  } catch {
    // Render frame may be disposed during navigation/reload — swallow silently
  }
}

function broadcastSafe(channel: string, ...args: unknown[]): void {
  BrowserWindow.getAllWindows().forEach((win) => safeSend(win, channel, ...args));
}

const registerIpcHandlers = () => {
  ipcMain.handle("closeApp", (event) => {
    if (process.platform !== "darwin") {
      const win = BrowserWindow.fromWebContents(event.sender);
      forceClose = true;
      win?.close();
    }
  });

  ipcMain.handle("minimizeApp", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.minimize();
  });

  ipcMain.handle("toggleDevTools", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    win?.webContents.toggleDevTools();
  });

  ipcMain.handle("maximizeApp", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize();
      } else {
        win.maximize();
      }
    }
  });

  ipcMain.handle("log", (_event, args) => {
    console.log("Log message received:", args);
  });

  ipcMain.handle("readstorage", () => {
    try {
      const data = readData();
      return data;
    } catch (error) {
      console.error("There was an error fetching flowData:", error);
      throw error;
    }
  });

  ipcMain.handle("savestorage", (_event, data) => {
    try {
      writeData(data);
    } catch (error) {
      console.error("There was an error saving flowData:", error);
      throw error;
    }
  });

  ipcMain.handle("readlibrary", () => {
    try {
      const data = readLibrary();
      return data;
    } catch (error) {
      console.error("There was an error fetching library data:", error);
      throw error;
    }
  });

  ipcMain.handle("savelibrary", (_event, data) => {
    try {
      writeLibrary(data);
    } catch (error) {
      console.error("There was an error saving library data:", error);
      throw error;
    }
  });

  ipcMain.handle("readtimeline", () => {
    try {
      const data = readTimeline();
      return data;
    } catch (error) {
      console.error("There was an error fetching timeline data:", error);
      throw error;
    }
  });

  ipcMain.handle("savetimeline", (_event, data) => {
    try {
      writeTimeline(data);
    } catch (error) {
      console.error("There was an error saving timeline data:", error);
      throw error;
    }
  });

  ipcMain.handle("getaudiometadata", async (_event, filePath: string) => {
    try {
      const metadata = await getAudioData(filePath);
      return metadata;
    } catch (error) {
      console.error("There was an error reading audio metadata:", error);
      throw error;
    }
  });

  ipcMain.handle("dialog:showSaveDialog", async (_event, options: Electron.SaveDialogOptions) => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      return await dialog.showSaveDialog(window, options);
    }
    return await dialog.showSaveDialog(options);
  });

  ipcMain.handle("dialog:showOpenDialog", async (_event, options: Electron.OpenDialogOptions) => {
    const window = BrowserWindow.getFocusedWindow();
    if (window) {
      return await dialog.showOpenDialog(window, options);
    }
    return await dialog.showOpenDialog(options);
  });

  ipcMain.handle("readProject", async (_event, filePath: string) => {
    try {
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, "utf-8");
      }
      return null;
    } catch (error) {
      console.error(error);
      return null;
    }
  });

  ipcMain.handle("saveProject", async (_event, filePath: string, data: string) => {
    try {
      fs.writeFileSync(filePath, data, "utf-8");
      return true;
    } catch (error) {
      console.error(error);
      return false;
    }
  });

  ipcMain.handle("openfiledialog", async (event, options?: any) => {
    let result: Electron.OpenDialogReturnValue;

    try {
      const defaultOptions: Electron.OpenDialogOptions = {
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Audio Files",
            extensions: [
              "mp3",
              "wav",
              "flac",
              "ogg",
              "aac",
              "m4a",
              "wma",
              "opus",
            ],
          },
        ],
      };

      const finalOptions = options
        ? { ...defaultOptions, ...options }
        : defaultOptions;

      const win = BrowserWindow.fromWebContents(event.sender);
      result = win
        ? await dialog.showOpenDialog(win, finalOptions)
        : await dialog.showOpenDialog(finalOptions);
      return result?.canceled ? [] : result?.filePaths;
    } catch (error) {
      console.log(error);
    }
  });

  ipcMain.handle(
    "saverecording",
    async (
      _event,
      fileName: string,
      arrayBuffer: ArrayBuffer,
      customPath?: string,
    ) => {
      try {
        let dirPath = customPath;
        if (!dirPath) {
          const documentsPath = app.getPath("documents");
          dirPath = path.join(documentsPath, "SonicPlank.Maker", "recordings");
        }
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        const filePath = path.join(dirPath, fileName);
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(filePath, buffer);
        return filePath;
      } catch (error) {
        console.error("Failed to save recording:", error);
        throw error;
      }
    },
  );

  ipcMain.handle("getScreenSources", async (_event, options) => {
    try {
      const sources = await desktopCapturer.getSources(
        options || {
          types: ["screen", "window"],
          thumbnailSize: { width: 300, height: 200 },
        },
      );
      return sources.map((source) => ({
        id: source.id,
        name: source.name,
        thumbnailUrl: source.thumbnail.toDataURL(),
        appIconUrl: source.appIcon ? source.appIcon.toDataURL() : null,
      }));
    } catch (error) {
      console.error("Failed to get screen sources:", error);
      throw error;
    }
  });

  ipcMain.handle("getDisplays", () => {
    try {
      const displays = screen.getAllDisplays();
      const primaryId = screen.getPrimaryDisplay().id;
      return displays.map((d) => ({
        id: d.id,
        bounds: {
          x: d.bounds.x,
          y: d.bounds.y,
          width: d.bounds.width,
          height: d.bounds.height,
        },
        scaleFactor: d.scaleFactor,
        isPrimary: d.id === primaryId,
      }));
    } catch (error) {
      console.error("Failed to get displays:", error);
      throw error;
    }
  });

  ipcMain.handle("setOverlays", (_event, overlays) => {
    try {
      activeOverlays = overlays || [];
      broadcastSafe("onOverlaysUpdated", activeOverlays);

      // Forward blur overlay bounds to the compositor as absolute pixel coordinates.
      const blurElements = (activeOverlays as { type: string; x: number; y: number; width: number; height: number; blurRadius?: number }[])
        .filter((el) => el.type === "blur");
      const sw = activeStreamOutWidth;
      const sh = activeStreamOutHeight;
      const regions = blurElements.map((el) => ({
        x: Math.round((el.x / 100) * sw),
        y: Math.round((el.y / 100) * sh),
        w: Math.round((el.width / 100) * sw),
        h: Math.round((el.height / 100) * sh),
        radius: Math.round((el.blurRadius ?? 10) * (sh / 1080)),
      }));
      sendCoreCommand({ type: "set_blur_regions", regions });
    } catch (error) {
      console.error("Failed to propagate overlays:", error);
      throw error;
    }
  });

  ipcMain.handle("getOverlays", () => {
    return activeOverlays;
  });

  ipcMain.on("sendAudioData", (event, visualizerId, dataArray) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win.webContents !== event.sender) safeSend(win, "onAudioDataUpdated", visualizerId, dataArray);
    });
  });

  ipcMain.on("sendChatMessages", (event, nodeId, messages) => {
    cachedChatMessages.set(nodeId, messages);
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win.webContents !== event.sender) safeSend(win, "onChatMessagesUpdated", nodeId, messages);
    });
  });

  ipcMain.handle("getChatMessages", () => Object.fromEntries(cachedChatMessages));

  ipcMain.handle(
    "connectTwitchChat",
    async (_, nodeId: string, channel: string, token: string, maxMessages: number) => {
      // Stop any existing listener for this node
      const prev = twitchListeners.get(nodeId);
      if (prev) {
        prev.stop();
        twitchListeners.delete(nodeId);
      }

      const rawToken = token.replace(/^oauth:/i, "");
      if (!rawToken) return { success: false, error: "No token provided" };

      try {
        // Validate token → get clientId + userId without needing to know them upfront
        const validateRes = await fetch("https://id.twitch.tv/oauth2/validate", {
          headers: { Authorization: `OAuth ${rawToken}` },
        });
        if (!validateRes.ok) {
          throw new Error(`Token validation failed: ${validateRes.status}`);
        }
        const { client_id: clientId, user_id: userId, scopes } =
          (await validateRes.json()) as { client_id: string; user_id: string; scopes: string[] };

        // Ensure the token has the required scope
        if (!scopes.includes("user:read:chat")) {
          throw new Error(
            'Token missing "user:read:chat" scope — re-generate with that scope checked',
          );
        }

        const { StaticAuthProvider } = await import("@twurple/auth");
        const { ApiClient } = await import("@twurple/api");
        const { EventSubWsListener } = await import("@twurple/eventsub-ws");

        const authProvider = new StaticAuthProvider(clientId, rawToken, scopes);
        const apiClient = new ApiClient({ authProvider });

        // Resolve broadcaster's user ID
        const broadcaster = await apiClient.users.getUserByName(channel.toLowerCase().replace(/^#/, ""));
        if (!broadcaster) throw new Error(`Channel "${channel}" not found on Twitch`);

        const listener = new EventSubWsListener({ apiClient });
        twitchListeners.set(nodeId, listener);
        listener.start();

        listener.onChannelChatMessage(broadcaster.id, userId, (event) => {
          const newMsg = {
            id: event.messageId,
            username: event.chatterDisplayName,
            color: event.color || "#9147ff",
            message: event.messageText,
            timestamp: Date.now(),
          };
          const existing = cachedChatMessages.get(nodeId) ?? [];
          const next = [...existing, newMsg].slice(-Math.max(1, maxMessages));
          cachedChatMessages.set(nodeId, next);
          broadcastSafe("onChatMessagesUpdated", nodeId, next);
        });

        return { success: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[TwitchChat]", msg);
        const cleanup = twitchListeners.get(nodeId);
        if (cleanup) {
          cleanup.stop();
          twitchListeners.delete(nodeId);
        }
        return { success: false, error: msg };
      }
    },
  );

  ipcMain.handle("disconnectTwitchChat", (_, nodeId: string) => {
    const listener = twitchListeners.get(nodeId);
    if (listener) {
      listener.stop();
      twitchListeners.delete(nodeId);
    }
    cachedChatMessages.delete(nodeId);
    broadcastSafe("onChatMessagesUpdated", nodeId, []);
  });

  ipcMain.on("sendAudioTime", (event, nodeId, currentTime, paused) => {
    // Broadcast to ALL windows including the sender — audio-node, now-playing-node,
    // and target-output-node all live in the same renderer window, so excluding
    // the sender would silently drop every update before it reaches the compositor.
    broadcastSafe("onAudioTimeUpdated", nodeId, currentTime, paused);
  });

  // function spawnFfmpegStream(ffmpegArgs: string[]) {
  //   ffmpegProcess = spawn("ffmpeg", ffmpegArgs);

  //   ffmpegProcess.stdin.on("error", (err: any) => {
  //     console.error("FFmpeg stdin error:", err);
  //   });

  //   ffmpegProcess.stderr.on("data", (data: any) => {
  //     const line: string = data.toString();
  //     console.log(`FFmpeg status: ${line}`);

  //     // Parse the progress line: frame= NNN fps= NN q=... size=...KiB time=... bitrate=...kbits/s speed=...x drop=NNN
  //     const frameMatch = line.match(/frame=\s*(\d+)/);
  //     const fpsMatch = line.match(/fps=\s*([\d.]+)/);
  //     const sizeMatch = line.match(/size=\s*([\d.]+\s*\w+)/);
  //     const timeMatch = line.match(/time=\s*([\d:.]+)/);
  //     const bitrateMatch = line.match(/bitrate=\s*([\d.]+\s*\w+\/s)/);
  //     const speedMatch = line.match(/speed=\s*([\d.]+x)/);
  //     const dropMatch = line.match(/drop=\s*(\d+)/);

  //     if (fpsMatch || bitrateMatch || frameMatch || timeMatch) {
  //       const stats = {
  //         frame: frameMatch ? parseInt(frameMatch[1]) : null,
  //         fps: fpsMatch ? parseFloat(fpsMatch[1]) : null,
  //         size: sizeMatch ? sizeMatch[1].trim() : null,
  //         time: timeMatch ? timeMatch[1].trim() : null,
  //         bitrate: bitrateMatch ? bitrateMatch[1].trim() : null,
  //         speed: speedMatch ? speedMatch[1].trim() : null,
  //         dropped: dropMatch ? parseInt(dropMatch[1]) : null,
  //       };
  //       BrowserWindow.getAllWindows().forEach((win) => {
  //         if (!win.isDestroyed()) win.webContents.send("onStreamStatus", stats);
  //       });
  //     }
  //   });

  //   ffmpegProcess.on("close", (code: number) => {
  //     console.log(`FFmpeg process exited with code ${code}`);
  //     ffmpegProcess = null;
  //   });
  // }

  ipcMain.handle("getGpuList", async () => {
    try {
      const gpuInfo = await app.getGPUInfo("basic") as any;
      const gpus = gpuInfo?.gpuDevice || [];
      return gpus.map((g: any) => g.deviceString || g.vendorString || "Unknown GPU");
    } catch {
      return [];
    }
  });

  // ipcMain.handle("startStream", (_event, rtmpUrl, options) => {
  //   try {
  //     if (ffmpegProcess) {
  //       ffmpegProcess.kill();
  //       ffmpegProcess = null;
  //     }

  //     const mode = options?.mode || "mjpeg";
  //     const encoder = options?.encoder || "libx264";
  //     const bitrateKbps = options?.bitrateKbps || 6000;
  //     const fps: number =
  //       Number((options as Record<string, unknown>)?.fps) || 30;
  //     const width: number | null = options?.width || null;
  //     const height: number | null = options?.height || null;
  //     const bufsizeKbps = bitrateKbps * 2;

  //     // Configure stream delay — frames are held in the delay buffer for this
  //     // many milliseconds before being written to FFmpeg stdin.
  //     streamDelayMs =
  //       Number((options as Record<string, unknown>)?.streamDelayMs) || 0;
  //     if (streamDelayMs > 0) {
  //       startDelayFlush();
  //     }

  //     // ── Mode: h264 ──────────────────────────────────────────────────────────
  //     // Frames are already encoded to H.264 on the GPU by the renderer's
  //     // WebCodecs VideoEncoder. FFmpeg only needs to mux to FLV — `-c:v copy`,
  //     // no decode, no re-encode (near-zero CPU). The FLV muxer auto-converts
  //     // the Annex-B bitstream to AVCC, so no bitstream filter is required.
  //     if (mode === "h264") {
  //       console.log(
  //         `Starting FFmpeg RTMP mux (WebCodecs H.264 passthrough) to ${rtmpUrl} | ${fps}fps`,
  //       );
  //       const ffmpegArgs = [
  //         "-y",
  //         "-progress",
  //         "pipe:2",
  //         // Give the h264 demuxer up to 5 s / 5 MB to find the SPS NAL.
  //         // The raw h264 demuxer defaults to analyzeduration=0 which causes it
  //         // to give up before the first keyframe arrives through the MessagePort.
  //         "-probesize",
  //         "5000000",
  //         "-analyzeduration",
  //         "5000000",
  //         // +genpts: generate PTS from the frame-count DTS assigned by -r.
  //         "-fflags",
  //         "+genpts",
  //         // Monotonic DTS by frame count — avoids non-monotonic warnings under
  //         // burst delivery from the compositor.
  //         "-r",
  //         `${fps}`,
  //         "-f",
  //         "h264",
  //         "-i",
  //         "pipe:0",
  //         "-c:v",
  //         "copy",
  //         "-an",
  //         "-f",
  //         "flv",
  //         rtmpUrl,
  //       ];
  //       spawnFfmpegStream(ffmpegArgs);
  //       return { success: true };
  //     }

  //     // ── Mode: mjpeg (fallback) ──────────────────────────────────────────────
  //     const resLabel = width && height ? ` | output: ${width}x${height}` : "";
  //     console.log(
  //       `Starting FFmpeg RTMP stream to ${rtmpUrl} | encoder: ${encoder} | bitrate: ${bitrateKbps}k | ${fps}fps${resLabel}`,
  //     );

  //     const ffmpegArgs = [
  //       "-y",
  //       "-progress",
  //       "pipe:2",
  //       "-f",
  //       "image2pipe",
  //       "-framerate",
  //       `${fps}`,
  //       "-vcodec",
  //       "mjpeg",
  //       "-i",
  //       "pipe:0",
  //     ];

  //     if (encoder === "hevc_nvenc") {
  //       ffmpegArgs.push(
  //         "-c:v",
  //         "h264_nvenc",
  //         "-preset",
  //         "p4",
  //         "-pix_fmt",
  //         "yuv420p",
  //         "-b:v",
  //         `${bitrateKbps}k`,
  //         "-maxrate:v",
  //         `${bitrateKbps}k`,
  //         "-bufsize:v",
  //         `${bufsizeKbps}k`,
  //         "-g",
  //         `${fps * 2}`,
  //       );
  //     } else if (encoder === "h264_amf") {
  //       ffmpegArgs.push(
  //         "-c:v",
  //         "h264_amf",
  //         "-pix_fmt",
  //         "yuv420p",
  //         "-b:v",
  //         `${bitrateKbps}k`,
  //         "-maxrate:v",
  //         `${bitrateKbps}k`,
  //         "-bufsize:v",
  //         `${bufsizeKbps}k`,
  //         "-g",
  //         `${fps * 2}`,
  //       );
  //     } else if (encoder === "h264_qsv") {
  //       ffmpegArgs.push(
  //         "-c:v",
  //         "h264_qsv",
  //         "-pix_fmt",
  //         "yuv420p",
  //         "-b:v",
  //         `${bitrateKbps}k`,
  //         "-maxrate:v",
  //         `${bitrateKbps}k`,
  //         "-bufsize:v",
  //         `${bufsizeKbps}k`,
  //         "-g",
  //         `${fps * 2}`,
  //       );
  //     } else {
  //       ffmpegArgs.push(
  //         "-c:v",
  //         "libx264",
  //         "-preset",
  //         "ultrafast",
  //         "-threads",
  //         "0",
  //         "-pix_fmt",
  //         "yuv420p",
  //         "-b:v",
  //         `${bitrateKbps}k`,
  //         "-maxrate:v",
  //         `${bitrateKbps}k`,
  //         "-bufsize:v",
  //         `${bufsizeKbps}k`,
  //         "-g",
  //         `${fps * 2}`,
  //       );
  //     }

  //     if (width && height && width > 0 && height > 0) {
  //       const w = Math.round(width / 2) * 2;
  //       const h = Math.round(height / 2) * 2;
  //       ffmpegArgs.push("-vf", `scale=${w}:${h}:flags=lanczos`);
  //     }

  //     ffmpegArgs.push("-an", "-f", "flv", rtmpUrl);

  //     spawnFfmpegStream(ffmpegArgs);

  //     return { success: true };
  //   } catch (error: any) {
  //     console.error("Failed to start FFmpeg streaming process:", error);
  //     throw error;
  //   }
  // });

  // ipcMain.handle("stopStream", () => {
  //   try {
  //     // Flush any buffered frames before closing — preserves content queued
  //     // in the delay buffer so the last N seconds reach the RTMP server.
  //     stopDelayFlush(true);
  //     streamDelayMs = 0;
  //     if (ffmpegProcess) {
  //       ffmpegProcess.stdin.end();
  //       ffmpegProcess.kill();
  //       ffmpegProcess = null;
  //       console.log("FFmpeg RTMP stream stopped.");
  //     }
  //     return { success: true };
  //   } catch (error: any) {
  //     console.error("Failed to stop FFmpeg streaming process:", error);
  //     throw error;
  //   }
  // });

  // ipcMain.on("pushStreamData", (_event, arrayBuffer) => {
  //   const buf = Buffer.from(arrayBuffer as ArrayBuffer);
  //   if (streamDelayMs > 0) {
  //     streamDelayBuffer.push({ data: buf, receivedAt: Date.now() });
  //   } else {
  //     try {
  //       const stdin = getStdin();
  //       if (stdin) stdin.write(buf);
  //     } catch (error) {
  //       console.error("Failed to push streaming buffer to FFmpeg:", error);
  //     }
  //   }
  // });

  ipcMain.handle("getAvailableThemes", async () => {
    ensureThemesDir();
    try {
      const files = fs.readdirSync(themesDir);
      const themes: any[] = [];
      for (const file of files) {
        const fullPath = path.join(themesDir, file);
        if (file.endsWith(".asar")) {
          try {
            const jsonStr = fs.readFileSync(
              path.join(fullPath, "theme.json"),
              "utf8",
            );
            const info = JSON.parse(jsonStr);
            themes.push({ id: file, ...info, isAsar: true });
          } catch (err) {
            console.error(
              `Failed to read theme.json inside asar: ${file}`,
              err,
            );
          }
        } else {
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            const jsonPath = path.join(fullPath, "theme.json");
            if (fs.existsSync(jsonPath)) {
              try {
                const jsonStr = fs.readFileSync(jsonPath, "utf8");
                const info = JSON.parse(jsonStr);
                themes.push({ id: file, ...info, isAsar: false });
              } catch (err) {
                console.error(
                  `Failed to read theme.json in directory: ${file}`,
                  err,
                );
              }
            }
          }
        }
      }
      return themes;
    } catch (err) {
      console.error("Failed to read available themes:", err);
      return [];
    }
  });

  ipcMain.handle("loadThemeStyles", async (_event, themeId: string) => {
    const cleanId = path.basename(themeId);
    const cssPath = path.join(themesDir, cleanId, "theme.css");
    try {
      if (fs.existsSync(cssPath)) {
        return fs.readFileSync(cssPath, "utf8");
      }
    } catch (err) {
      console.error(`Failed to load theme styles for: ${themeId}`, err);
    }
    return "";
  });

  // ── Overlay Theme IPC ────────────────────────────────────────────────────────

  ipcMain.handle("installOverlayTheme", async (_event, filePath: string) => {
    ensureOverlayThemesDir();
    try {
      const zip = new AdmZip(filePath);
      const jsonEntry = zip.getEntry("theme.json");
      if (!jsonEntry) return { error: "theme.json not found in archive" };
      const meta = JSON.parse(jsonEntry.getData().toString("utf8"));
      if (!meta.id || !meta.name) return { error: "theme.json missing required 'id' or 'name' field" };
      const themeId = path.basename(String(meta.id));
      const destDir = path.join(overlayThemesDir, themeId);
      zip.extractAllTo(destDir, true);
      const previewPath = path.join(destDir, "preview.png");
      return {
        id: themeId,
        name: meta.name,
        author: meta.author ?? "",
        description: meta.description ?? "",
        previewImagePath: fs.existsSync(previewPath) ? previewPath : undefined,
        themeDir: destDir,
      };
    } catch (err: any) {
      console.error("Failed to install overlay theme:", err);
      return { error: String(err?.message ?? err) };
    }
  });

  ipcMain.handle("getInstalledOverlayThemes", async () => {
    ensureOverlayThemesDir();
    try {
      const entries = fs.readdirSync(overlayThemesDir);
      const themes: any[] = [];
      for (const entry of entries) {
        const dir = path.join(overlayThemesDir, entry);
        if (!fs.statSync(dir).isDirectory()) continue;
        const jsonPath = path.join(dir, "theme.json");
        if (!fs.existsSync(jsonPath)) continue;
        try {
          const meta = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
          const previewPath = path.join(dir, "preview.png");
          themes.push({
            id: entry,
            name: meta.name ?? entry,
            author: meta.author ?? "",
            description: meta.description ?? "",
            previewImagePath: fs.existsSync(previewPath) ? previewPath : undefined,
            themeDir: dir,
          });
        } catch {
          // skip malformed theme
        }
      }
      return themes;
    } catch (err) {
      console.error("Failed to list overlay themes:", err);
      return [];
    }
  });

  ipcMain.handle("uninstallOverlayTheme", async (_event, themeId: string) => {
    ensureOverlayThemesDir();
    const cleanId = path.basename(String(themeId));
    const dir = path.join(overlayThemesDir, cleanId);
    if (!fs.existsSync(dir)) return { success: false, error: "Theme not found" };
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return { success: true };
    } catch (err: any) {
      return { success: false, error: String(err?.message ?? err) };
    }
  });

  ipcMain.handle("loadOverlayTheme", async (_event, themeId: string) => {
    ensureOverlayThemesDir();
    const cleanId = path.basename(String(themeId));
    const dir = path.join(overlayThemesDir, cleanId);
    const jsonPath = path.join(dir, "theme.json");
    if (!fs.existsSync(jsonPath)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
      const previewPath = path.join(dir, "preview.png");
      return {
        id: cleanId,
        name: raw.name ?? cleanId,
        author: raw.author ?? "",
        description: raw.description ?? "",
        previewImagePath: fs.existsSync(previewPath) ? previewPath : undefined,
        themeDir: dir,
        variables: Array.isArray(raw.variables) ? raw.variables : [],
        defaultSceneId: typeof raw.defaultSceneId === "string" ? raw.defaultSceneId : undefined,
        scenes: Array.isArray(raw.scenes)
          ? raw.scenes.map((s: any) => ({ ...s, sources: Array.isArray(s.sources) ? s.sources : [] }))
          : [{ id: "base", name: "Base", transition: { durationMs: 500 }, elements: Array.isArray(raw.elements) ? raw.elements : [], components: Array.isArray(raw.components) ? raw.components : [], sources: [] }],
      };
    } catch (err) {
      console.error(`Failed to load overlay theme '${themeId}':`, err);
      return null;
    }
  });

  // ── Marquee theme authoring IPC ─────────────────────────────────────────────

  ipcMain.handle("saveOverlayTheme", async (_event, { themeJson, assets, savePath }: {
    themeJson: string;
    assets: { localPath: string; archiveName: string }[];
    savePath: string;
  }) => {
    try {
      const zip = new AdmZip();
      zip.addFile("theme.json", Buffer.from(themeJson, "utf8"));
      for (const { localPath, archiveName } of assets) {
        if (fs.existsSync(localPath)) {
          zip.addLocalFile(localPath, "assets", archiveName);
        }
      }
      zip.writeZip(savePath);
      return { success: true };
    } catch (err: any) {
      console.error("Failed to save overlay theme:", err);
      return { success: false, error: String(err?.message ?? err) };
    }
  });

  ipcMain.handle("openThemeForEditing", async (_event, filePath: string) => {
    try {
      const zip = new AdmZip(filePath);
      const themeJson = zip.readAsText("theme.json");
      if (!themeJson) return { error: "theme.json not found in archive" };
      const tmpDir = path.join(
        app.getPath("temp"),
        "SonicPlank-MarqueeEdit",
        crypto.randomUUID(),
      );
      zip.extractAllTo(tmpDir, true);
      return { themeJson, tmpDir };
    } catch (err: any) {
      console.error("Failed to open theme for editing:", err);
      return { error: String(err?.message ?? err) };
    }
  });

  // Open the Edit Overlay window as an in-process BrowserWindow.
  // The preview receives compositor frames from the editor via BroadcastChannel
  // ('sonicplank-preview-frames') — no second capture, no WGC session conflict.
  ipcMain.handle(
    "openEditOverlay",
    (event, args: { aspect?: string; fitMode?: string } | undefined) => {
      if (previewWin && !previewWin.isDestroyed()) {
        previewWin.focus();
        return;
      }

      const aspect: string = args?.aspect ?? "16/9";
      const fitMode: string = args?.fitMode ?? "contain";
      const startUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL
        ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/preview?aspect=${encodeURIComponent(aspect)}&fitMode=${encodeURIComponent(fitMode)}`
        : `file://${path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)}#/preview?aspect=${encodeURIComponent(aspect)}&fitMode=${encodeURIComponent(fitMode)}`;

      console.log("[Main] Opening Edit Overlay window:", startUrl);

      previewWin = new BrowserWindow({
        icon: getIconPath(),
        autoHideMenuBar: true,
        minWidth: 960,
        minHeight: 540,
        width: 1920,
        height: 1080,
        title: "Overlay Editor",
        webPreferences: {
          devTools: inDevelopment,
          preload: path.join(__dirname, "preload.js"),
          webSecurity: false,
        },
      });

      previewWin.removeMenu();
      void previewWin.loadURL(startUrl);

      if (inDevelopment) {
        previewWin.webContents.openDevTools();
      }

      // Send current overlays and establish the preview frame MessagePort pair
      // once the preview renderer is ready.
      previewWin.webContents.once("did-finish-load", () => {
        if (previewWin && !previewWin.isDestroyed()) {
          previewWin.webContents.send("onOverlaysUpdated", activeOverlays);
          // Zero-copy preview frame channel: compositor renderer → preview window.
          // sendPort stays in the editor renderer; receivePort goes to previewWin.
          const { port1: sendPort, port2: receivePort } =
            new MessageChannelMain();
          event.sender.postMessage("previewSendPort", null, [sendPort]);
          previewWin.webContents.postMessage("previewReceivePort", null, [
            receivePort,
          ]);
        }
      });

      previewWin.on("closed", () => {
        console.log("[Main] Edit Overlay window closed.");
        previewWin = null;
        // Notify editor windows so they can stop broadcasting frames
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) {
            win.webContents.send("editOverlayClosed");
          }
        });
      });
    },
  );

  ipcMain.handle("updateFitMode", (event, fitMode: string) => {
    if (previewWin && !previewWin.isDestroyed()) {
      previewWin.webContents.send("onFitModeUpdated", fitMode);
    }
  });

  // Preview window notifies main when it receives its first compositor frame.
  // Main relays to all other windows (the editor) so it can update its status dialog.
  ipcMain.on("editOverlayConnected", (event) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed() && win.webContents !== event.sender) {
        win.webContents.send("editOverlayConnected");
      }
    });
  });

  // Spotify PKCE OAuth flow — opens a dedicated BrowserWindow, intercepts the
  // redirect to extract the auth code, exchanges it for tokens, and returns them
  // to the renderer. Requires http://127.0.0.1:8888/callback registered in the
  // Spotify Developer Dashboard.
  // ── Native preview (Phase 1) ────────────────────────────────────────────────
  // These handlers bridge the renderer to the Rust capture core via stdin/stdout.

  let pendingSourcesPromise: Promise<any[]> | null = null;

  ipcMain.handle("getPreviewSources", async () => {
    if (!coreProcess) return [];
    if (pendingSourcesPromise) return pendingSourcesPromise;

    pendingSourcesPromise = (async () => {
      sendCoreCommand({ type: "get_sources" });
      try {
        const ev = await waitForCoreEvent<{ items: unknown[] }>("sources");
        return ev.items ?? [];
      } catch (e) {
        console.error("[Core] getPreviewSources failed:", e);
        return [];
      } finally {
        pendingSourcesPromise = null;
      }
    })();

    return pendingSourcesPromise;
  });

  let pendingAudioDevicesPromise: Promise<any[]> | null = null;

  ipcMain.handle("getAudioDevices", async () => {
    if (!coreProcess) return [];
    if (pendingAudioDevicesPromise) return pendingAudioDevicesPromise;

    pendingAudioDevicesPromise = (async () => {
      sendCoreCommand({ type: "get_audio_devices" });
      try {
        const ev = await waitForCoreEvent<{ items: unknown[] }>("audio_devices");
        return ev.items ?? [];
      } catch (e) {
        console.error("[Core] getAudioDevices failed:", e);
        return [];
      } finally {
        pendingAudioDevicesPromise = null;
      }
    })();

    return pendingAudioDevicesPromise;
  });

  ipcMain.handle("getWaveformPeaks", async (_event, path: string, pixelsPerSecond: number) => {
    if (!coreProcess) throw new Error("Core not running");

    sendCoreCommand({ type: "get_waveform_peaks", path, pixels_per_second: pixelsPerSecond });

    try {
      const ev = await waitForCoreEvent<{ path: string, peaks: number[] }>("waveform_peaks", 60000, (e) => e.path === path);
      return ev.peaks ?? [];
    } catch (e) {
      console.error("[Core] getWaveformPeaks failed:", e);
      return [];
    }
  });

  ipcMain.handle("startPreviewCapture", async (_event, sourceId: string) => {
    if (!coreProcess) throw new Error("Core not running");

    const count = activeCaptures.get(sourceId) || 0;
    activeCaptures.set(sourceId, count + 1);

    if (count === 0) {
      await ensureOverlayWindow();
      sendCoreCommand({ type: "start_capture", source_id: sourceId });
    }

    sendCoreCommand({ type: "enable_preview" });
    nativePreviewActive = true;
  });

  ipcMain.handle("stopPreviewCapture", async (_event, sourceId: string) => {
    if (!coreProcess) return;

    let count = activeCaptures.get(sourceId) || 0;
    count = Math.max(0, count - 1);

    if (count === 0) {
      activeCaptures.delete(sourceId);
      sendCoreCommand({ type: "stop_capture", source_id: sourceId });
    } else {
      activeCaptures.set(sourceId, count);
    }

    if (activeCaptures.size === 0) {
      nativePreviewActive = false;
      sendCoreCommand({ type: "disable_preview" });
    }
  });

  let latestCoreConfig: any[] | null = null;

  ipcMain.handle("setCoreConfig", async (_event, sources: any[]) => {
    if (coreProcess && !coreProcess.killed) {
      sendCoreCommand({ type: "config", sources });
      latestCoreConfig = sources;
    }
  });

  ipcMain.handle(
    "setOverlayResolution",
    async (_event, width: number, height: number) => {
      overlayConfigWidth = width;
      overlayConfigHeight = height;
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        overlayWindow.setSize(width, height);
      }
    },
  );

  ipcMain.handle(
    "startNativeStream",
    async (
      _event,
      options: {
        rtmpUrl: string;
        bitrateKbps?: number;
        fps?: number;
        outputWidth?: number;
        outputHeight?: number;
        fitMode?: string;
        encoder?: string;
        audioDeviceIds?: string[];
        recordPath?: string;
        twitchToken?: string;
        youtubeClientId?: string;
        youtubeClientSecret?: string;
        youtubeRefreshToken?: string;
        youtubeAutoUpload?: boolean;
        sources: {
          source_id: string;
          is_primary: boolean;
          x_percent: number;
          y_percent: number;
          w_percent: number;
          h_percent: number;
        }[];
      },
    ) => {
      if (!coreProcess) throw new Error("Core not running");

      activeStreamSources = options.sources.map((s) => ({
        source_id: s.source_id,
      }));
      for (const src of options.sources) {
        const count = activeCaptures.get(src.source_id) || 0;
        activeCaptures.set(src.source_id, count + 1);
        if (count === 0) {
          await ensureOverlayWindow();
          sendCoreCommand({ type: "start_capture", source_id: src.source_id });
        }
      }

      // Read bitrate from encoder config; fall back to 6000 kbps.
      let bitrateKbps = 6000;
      try {
        const cfg = JSON.parse(
          fs.readFileSync(getEncoderConfigPath(), "utf-8"),
        ) as { bitrate_kbps?: number };
        if (cfg.bitrate_kbps) bitrateKbps = cfg.bitrate_kbps;
      } catch {
        /* use default */
      }

      // Build a timestamped recording path if the caller requested recording.
      // options.recordPath === undefined → no recording; "" → use default documents folder.
      let recordFilePath: string | null = null;
      if (options.recordPath !== undefined) {
        const dir = options.recordPath
          || path.join(app.getPath("documents"), "SonicPlank.Maker", "recordings");
        try { fs.mkdirSync(dir, { recursive: true }); } catch { /* already exists */ }
        const ts = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
        recordFilePath = path.join(dir, `recording_${ts}.mp4`);
        console.log(`[Recording] Will write to: ${recordFilePath}`);
      }

      // Persist for VOD tracking on stop.
      activeRecordFilePath = recordFilePath;
      activeStreamRtmpUrl = options.rtmpUrl;
      activeStreamTwitchToken = options.twitchToken ?? null;
      activeStreamYoutubeClientId = options.youtubeClientId ?? null;
      activeStreamYoutubeClientSecret = options.youtubeClientSecret ?? null;
      activeStreamYoutubeRefreshToken = options.youtubeRefreshToken ?? null;
      activeStreamYoutubeAutoUpload = !!(options.youtubeAutoUpload && options.youtubeClientId && options.youtubeRefreshToken);

      // Track stream fps so transition frame rate bumps match the stream.
      overlayStreamFps = options.fps ?? 30;

      // Delegate encoding and RTMP delivery entirely to the Rust core.
      sendCoreCommand({
        type: "start_stream",
        rtmp_url: options.rtmpUrl,
        bitrate_kbps: bitrateKbps,
        fps: options.fps ?? 30,
        output_width: options.outputWidth ?? null,
        output_height: options.outputHeight ?? null,
        fit_mode: options.fitMode ?? null,
        encoder: options.encoder ?? "libx264",
        audio_device_ids: options.audioDeviceIds ?? [],
        sources: options.sources,
        record_path: recordFilePath ?? undefined,
      });

      const ev = await waitForCoreEvent<{
        type: string;
        width: number;
        height: number;
      }>("stream_started", 15_000);
      nativeStreamStartAt = Date.now();
      activeStreamOutWidth = ev.width;
      activeStreamOutHeight = ev.height;
      console.log(`[Native stream] started ${ev.width}x${ev.height}`);
      updateApiState({ streaming: true, recording: !!recordFilePath });
      broadcastWsEvent("streamState", { streaming: true, recording: !!recordFilePath, viewerCount: 0 });

      // Start Twitch viewer-count polling (fire-and-forget token validation, then 10s interval)
      if (activeStreamTwitchToken) {
        void (async () => {
          try {
            const rawToken = (activeStreamTwitchToken as string).replace(/^oauth:/i, "");
            const vr = await fetch("https://id.twitch.tv/oauth2/validate", {
              headers: { Authorization: `OAuth ${rawToken}` },
            });
            if (!vr.ok) return;
            const { client_id, user_id } = (await vr.json()) as { client_id: string; user_id: string };
            activeStreamTwitchClientId = client_id;
            activeStreamTwitchUserId = user_id;
            void pollViewerCount(); // immediate first poll
            viewerCountIntervalId = setInterval(() => void pollViewerCount(), 10_000);
          } catch { /* not a blocking issue */ }
        })();
      }

      return { success: true, width: ev.width, height: ev.height };
    },
  );

  ipcMain.handle("stopNativeStream", async () => {
    // Snapshot tracking state before clearing — async VOD/upload needs these.
    const recordedFilePath = activeRecordFilePath;
    const streamRtmpUrl = activeStreamRtmpUrl;
    const streamTwitchToken = activeStreamTwitchToken;
    const youtubeClientId = activeStreamYoutubeClientId;
    const youtubeClientSecret = activeStreamYoutubeClientSecret;
    const youtubeRefreshToken = activeStreamYoutubeRefreshToken;
    const youtubeAutoUpload = activeStreamYoutubeAutoUpload;

    nativeStreamStartAt = null;
    activeRecordFilePath = null;
    activeStreamRtmpUrl = null;
    activeStreamTwitchToken = null;
    activeStreamTwitchUserId = null;
    activeStreamTwitchClientId = null;
    activeStreamYoutubeClientId = null;
    activeStreamYoutubeClientSecret = null;
    activeStreamYoutubeRefreshToken = null;
    activeStreamYoutubeAutoUpload = false;

    if (viewerCountIntervalId) {
      clearInterval(viewerCountIntervalId);
      viewerCountIntervalId = null;
    }

    updateApiState({ streaming: false, recording: false, viewerCount: 0 });
    broadcastWsEvent("streamState", { streaming: false, recording: false, viewerCount: 0 });

    if (coreProcess) {
      sendCoreCommand({ type: "stop_stream" });
      await waitForCoreEvent("stream_stopped", 5_000).catch(() => {});
    }

    for (const src of activeStreamSources) {
      let count = activeCaptures.get(src.source_id) || 0;
      count = Math.max(0, count - 1);

      if (count === 0) {
        activeCaptures.delete(src.source_id);
        if (coreProcess) {
          sendCoreCommand({ type: "stop_capture", source_id: src.source_id });
        }
      } else {
        activeCaptures.set(src.source_id, count);
      }
    }
    activeStreamSources = [];

    // Fire-and-forget VOD tracking if recording was active.
    if (recordedFilePath) {
      const platform = detectStreamPlatform(streamRtmpUrl ?? "");
      const stopTime = Date.now();

      if (youtubeAutoUpload && youtubeClientId && youtubeClientSecret && youtubeRefreshToken) {
        // YouTube upload takes priority when configured.
        broadcastVodStatus({ phase: "searching", platform: "youtube", filePath: recordedFilePath });
        void (async () => {
          try {
            const accessToken = await refreshYoutubeAccessToken(youtubeClientId, youtubeClientSecret, youtubeRefreshToken);
            const title = `Stream Recording ${new Date().toLocaleDateString()}`;
            const videoUrl = await uploadVideoToYoutube(
              recordedFilePath,
              accessToken,
              title,
              (pct) => broadcastVodStatus({ phase: "uploading", platform: "youtube", filePath: recordedFilePath, progress: pct }),
            );
            broadcastVodStatus({ phase: "found", platform: "youtube", filePath: recordedFilePath, vodUrl: videoUrl });
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            broadcastVodStatus({ phase: "error", platform: "youtube", filePath: recordedFilePath, message });
          }
        })();
      } else if (platform === "twitch" && streamTwitchToken) {
        // Show recording saved immediately (auto-dismisses), then poll silently for the VOD.
        broadcastVodStatus({ phase: "not_found", platform, filePath: recordedFilePath });
        void (async () => {
          try {
            const rawToken = streamTwitchToken.replace(/^oauth:/i, "");
            const validateRes = await fetch("https://id.twitch.tv/oauth2/validate", {
              headers: { Authorization: `OAuth ${rawToken}` },
            });
            if (!validateRes.ok) return;
            const { client_id: clientId, user_id: userId } = (await validateRes.json()) as {
              client_id: string;
              user_id: string;
            };
            const vodUrl = await pollTwitchVod(userId, clientId, rawToken, stopTime);
            if (vodUrl) {
              broadcastVodStatus({ phase: "found", platform, filePath: recordedFilePath, vodUrl });
            }
          } catch {
            // silent — recording was already confirmed to the user
          }
        })();
      } else {
        broadcastVodStatus({ phase: "not_found", platform, filePath: recordedFilePath });
      }
    }

    return { success: true };
  });

  ipcMain.handle("createTwitchClip", async () => {
    const clipUrl = await createTwitchClipApi();
    if (clipUrl) return { clipUrl };
    return { error: "not_streaming_twitch" };
  });

  ipcMain.handle("openRecordingFolder", (_event, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle("openExternalUrl", (_event, url: string) => {
    return shell.openExternal(url);
  });

  // ── Encoder config (encoder-config.json) ─────────────────────────────────
  // Electron reads/writes the file directly; the Rust core watches it and
  // reloads automatically. Both agree on the path via the same search order:
  // production → resources dir (next to binary); dev → process.cwd().
  function getEncoderConfigPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, "encoder-config.json");
    }
    return path.join(process.cwd(), "encoder-config.json");
  }

  ipcMain.handle("getEncoderConfig", (): unknown => {
    try {
      const content = fs.readFileSync(getEncoderConfigPath(), "utf-8");
      return JSON.parse(content) as unknown;
    } catch {
      return null;
    }
  });

  ipcMain.handle("setEncoderConfig", (_event, config: unknown) => {
    fs.writeFileSync(
      getEncoderConfigPath(),
      JSON.stringify(config, null, 2) + "\n",
      "utf-8",
    );
  });

  // ── Scene hotkeys ────────────────────────────────────────────────────────────
  // nodeId → list of registered accelerators for that overlay-theme node
  const nodeHotkeys = new Map<string, string[]>();

  ipcMain.handle(
    "registerSceneHotkeys",
    (
      _event,
      args: { nodeId: string; scenes: { sceneId: string; hotkey: string; durationMs: number }[] },
    ): { registered: string[]; failed: string[] } => {
      const { nodeId, scenes } = args;

      // Unregister any existing hotkeys for this node
      const existing = nodeHotkeys.get(nodeId) ?? [];
      for (const accel of existing) {
        globalShortcut.unregister(accel);
      }
      nodeHotkeys.delete(nodeId);

      const registered: string[] = [];
      const failed: string[] = [];

      for (const scene of scenes) {
        if (!scene.hotkey) continue;
        const ok = globalShortcut.register(scene.hotkey, () => {
          const payload = { nodeId, sceneId: scene.sceneId, durationMs: scene.durationMs };
          bumpOverlayFrameRateForTransition(scene.durationMs);
          BrowserWindow.getAllWindows().forEach((win) => safeSend(win, "onSceneSwitch", payload));
        });
        if (ok) {
          registered.push(scene.sceneId);
        } else {
          failed.push(scene.sceneId);
        }
      }

      nodeHotkeys.set(nodeId, registered.map((sid) => scenes.find((s) => s.sceneId === sid)!.hotkey));
      return { registered, failed };
    },
  );

  ipcMain.handle("unregisterSceneHotkeys", (_event, args: { nodeId: string }) => {
    const accels = nodeHotkeys.get(args.nodeId) ?? [];
    for (const accel of accels) {
      globalShortcut.unregister(accel);
    }
    nodeHotkeys.delete(args.nodeId);
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
  });

  // ── Stream Deck API bridge ───────────────────────────────────────────────────
  // Renderer sends state patches whenever streaming/recording/audio state changes.
  ipcMain.on("apiStateUpdate", (_event, patch: Record<string, unknown>) => {
    updateApiState(patch as any);
    // Broadcast relevant WS events based on what changed
    if ("streaming" in patch || "recording" in patch || "viewerCount" in patch) {
      const s = patch as { streaming?: boolean; recording?: boolean; viewerCount?: number };
      broadcastWsEvent("streamState", {
        streaming: s.streaming ?? false,
        recording: s.recording ?? false,
        viewerCount: s.viewerCount ?? 0,
      });
    }
    if ("audioSources" in patch) {
      broadcastWsEvent("audioState", { sources: patch.audioSources });
    }
    if ("media" in patch) {
      broadcastWsEvent("mediaState", patch.media);
    }
    if ("activeSceneId" in patch || "scenes" in patch) {
      broadcastWsEvent("sceneState", { activeSceneId: patch.activeSceneId, scenes: patch.scenes });
    }
  });

  ipcMain.handle(
    "triggerSceneSwitch",
    (_event, args: { nodeId: string; sceneId: string; durationMs: number }) => {
      const payload = { nodeId: args.nodeId, sceneId: args.sceneId, durationMs: args.durationMs };
      bumpOverlayFrameRateForTransition(args.durationMs);
      broadcastSafe("onSceneSwitch", payload);
    },
  );

  ipcMain.handle("initiateYoutubeAuth", (_event, opts: { clientId: string; clientSecret: string }) => {
    const port = 8079;
    const redirectUri = `http://localhost:${port}/oauth/callback`;

    return new Promise<{ refreshToken: string }>((resolve, reject) => {
      const server = http.createServer((req, res) => {
        const reqUrl = new URL(req.url ?? "/", `http://localhost:${port}`);
        if (reqUrl.pathname !== "/oauth/callback") { res.writeHead(404); res.end(); return; }

        const code = reqUrl.searchParams.get("code");
        const error = reqUrl.searchParams.get("error");

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          `<html><body style="font-family:sans-serif;padding:2rem;text-align:center">` +
          `<h2>${code ? "YouTube connected!" : "Connection failed."}</h2>` +
          `<p>You can close this tab and return to SonicPlank.</p></body></html>`,
        );
        server.close();

        if (error || !code) { reject(new Error(error ?? "No authorization code received")); return; }

        fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: opts.clientId,
            client_secret: opts.clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }).toString(),
        })
          .then((r) => r.json())
          .then((data: { refresh_token?: string; error?: string }) => {
            if (!data.refresh_token) throw new Error(data.error ?? "No refresh token — ensure 'access_type=offline' and 'prompt=consent'");
            resolve({ refreshToken: data.refresh_token });
          })
          .catch(reject);
      });

      server.listen(port, "127.0.0.1", () => {
        const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
        authUrl.searchParams.set("client_id", opts.clientId);
        authUrl.searchParams.set("redirect_uri", redirectUri);
        authUrl.searchParams.set("response_type", "code");
        authUrl.searchParams.set("scope", "https://www.googleapis.com/auth/youtube.upload");
        authUrl.searchParams.set("access_type", "offline");
        authUrl.searchParams.set("prompt", "consent");
        void shell.openExternal(authUrl.toString());
      });

      server.on("error", (err) => reject(err));
      setTimeout(() => { server.close(); reject(new Error("YouTube OAuth timed out")); }, 5 * 60 * 1000);
    });
  });

  ipcMain.handle("initiateSpotifyAuth", () => {
    const verifier = crypto.randomBytes(32).toString("base64url");
    const challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");

    const params = new URLSearchParams({
      response_type: "code",
      client_id: SPOTIFY_CLIENT_ID,
      scope: SPOTIFY_SCOPES.join(" "),
      redirect_uri: SPOTIFY_REDIRECT_URI,
      code_challenge_method: "S256",
      code_challenge: challenge,
    });

    const authUrl = `https://accounts.spotify.com/authorize?${params}`;

    return new Promise<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    }>((resolve, reject) => {
      const authWin = new BrowserWindow({
        icon: getIconPath(),
        width: 480,
        height: 700,
        autoHideMenuBar: true,
        title: "Connect to Spotify",
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });
      authWin.removeMenu();
      void authWin.loadURL(authUrl);

      let settled = false;

      const handleRedirect = async (url: string) => {
        if (!url.startsWith(SPOTIFY_REDIRECT_URI) || settled) return;
        settled = true;
        authWin.close();

        const parsed = new URL(url);
        const code = parsed.searchParams.get("code");
        const error = parsed.searchParams.get("error");

        if (error || !code) {
          reject(new Error(error ?? "No authorization code received"));
          return;
        }

        try {
          const body = new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: SPOTIFY_REDIRECT_URI,
            client_id: SPOTIFY_CLIENT_ID,
            code_verifier: verifier,
          });
          const resp = await fetch("https://accounts.spotify.com/api/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: body.toString(),
          });
          if (!resp.ok) {
            const text = await resp.text();
            throw new Error(`Token exchange failed (${resp.status}): ${text}`);
          }
          const data = (await resp.json()) as {
            access_token: string;
            refresh_token: string;
            expires_in: number;
          };
          resolve({
            accessToken: data.access_token,
            refreshToken: data.refresh_token,
            expiresIn: data.expires_in,
          });
        } catch (err) {
          reject(err);
        }
      };

      authWin.webContents.on("will-navigate", (event, url) => {
        if (url.startsWith(SPOTIFY_REDIRECT_URI)) {
          event.preventDefault();
          void handleRedirect(url);
        }
      });

      authWin.webContents.on("will-redirect", (event, url) => {
        if (url.startsWith(SPOTIFY_REDIRECT_URI)) {
          event.preventDefault();
          void handleRedirect(url);
        }
      });

      authWin.on("closed", () => {
        if (!settled) {
          settled = true;
          reject(new Error("Authentication window was closed"));
        }
      });
    });
  });
};

const getIconPath = () => {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "icon.ico");
  }
  return path.join(__dirname, "../../src/img/icon.ico");
};

const createWindow = async () => {
  const mainWindow = new BrowserWindow({
    icon: getIconPath(),
    width: 1400,
    height: 1000,
    autoHideMenuBar: true,
    minHeight: 1000,
    minWidth: 1400,
    titleBarStyle: "hidden",
    titleBarOverlay: false,
    ...(process.platform !== "darwin" ? {} : {}),
    webPreferences: {
      devTools: true,
      preload: path.join(__dirname, "preload.js"),
      webSecurity: false,
    },
  });

  mainWindow.removeMenu();

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    return {
      action: "allow",
      overrideBrowserWindowOptions: {
        autoHideMenuBar: true,
        minWidth: 800,
        minHeight: 450,
        width: 1280,
        height: 720,
        webPreferences: {
          preload: path.join(__dirname, "preload.js"),
          webSecurity: false,
        },
      },
    };
  });

  mainWindow.on("close", (e) => {
    if (!forceClose) {
      e.preventDefault();
      mainWindow.webContents.send("nativeWindowClose");
    }
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  const reactDevToolsPath = path.join(
    __dirname,
    "..\\..\\Extensions\\fmkadmapgofadopljbjfkapdkoienihi\\7.0.1_0",
  );

  if (inDevelopment) {
    mainWindow.webContents.openDevTools();

    if (fs.existsSync(reactDevToolsPath)) {
      try {
        await session.defaultSession.extensions.loadExtension(
          reactDevToolsPath,
        );
        console.log("React DevTools extension loaded successfully.");
      } catch (error) {
        console.error("Failed to load React DevTools extension:", error);
      }
    } else {
      console.warn(
        "React DevTools path does not exist, skipping load:",
        reactDevToolsPath,
      );
    }
  }

  app.setAboutPanelOptions({
    applicationName: "SonicPlank.Maker",
    credits: "Damon Batey",
    applicationVersion: "0.1.0",
    version: "0.1.0",
    copyright: "2026",
  });

  mainWindow.on("closed", () => {
    app.quit();
  });
};

app.on("ready", () => {
  registerIpcHandlers();
  void startCore();
  void createWindow();
  startApiServer((channel, payload) => {
    broadcastSafe(channel, payload);
  });
});

app.on("before-quit", () => {
  stopCore();
  stopApiServer();
});

// Force-kill the core as a backstop: the 300 ms timeout in stopCore() may not
// fire before Node.js exits, so this synchronous kill ensures no orphan process.
app.on("will-quit", () => {
  if (coreProcess) {
    coreProcess.kill();
    coreProcess = null;
  }
  if (coreDataSocket) {
    coreDataSocket.destroy();
    coreDataSocket = null;
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});
