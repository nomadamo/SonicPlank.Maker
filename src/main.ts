import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  MessageChannelMain,
  session,
  screen,
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
import readline from "node:readline";
import {
  SPOTIFY_CLIENT_ID,
  SPOTIFY_REDIRECT_URI,
  SPOTIFY_SCOPES,
} from "./constants/audio";
import started from "electron-squirrel-startup";
import { inDevelopment } from "./constants";
import { spawn } from "node:child_process";

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
let previewWin: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let overlayConfigWidth = 1920;
let overlayConfigHeight = 1080;

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

    // Forward each paint as a type-2 overlay frame to the Rust core.
    // Format: [u8=2][u32 w LE][u32 h LE][BGRA premultiplied pixels]
    // Belt-and-suspenders JS throttle in case Chromium fires events faster than setFrameRate.
    let lastOverlaySendMs = 0;
    overlayWindow.webContents.on("paint", (_event, _dirty, image) => {
      if (!coreDataSocket) return;
      const now = Date.now();
      if (now - lastOverlaySendMs < 100) return; // max 10 fps; bail before toBitmap()
      lastOverlaySendMs = now;

      const size = image.getSize();
      const bgra = image.toBitmap();
      const w = size.width;
      const h = size.height;
      if (bgra.length !== w * h * 4) return;

      const header = Buffer.alloc(9);
      header.writeUInt8(2, 0);
      header.writeUInt32LE(w, 1);
      header.writeUInt32LE(h, 5);

      try {
        // Two writes avoids a concat allocation equal to the full frame size.
        coreDataSocket.write(header);
        coreDataSocket.write(bgra);
      } catch {
        // pipe closed; ignore
      }
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
const coreEventListeners = new Map<
  string,
  (ev: Record<string, unknown>) => void
>();
let coreStdoutRl: readline.Interface | null = null;

// Accumulates partial binary frames arriving from the data pipe.
let coreFrameBuffer = Buffer.alloc(0);

let captureRefCount = 0; // Deprecated, remove later
let activeCaptures = new Map<string, number>();
let activeStreamSources: { source_id: string }[] = [];
let activeCaptureSourceId: string | null = null;
let nativeStreamStartAt: number | null = null;
let nativePreviewActive = false;

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
        console.log(`[Core] ACK: ${JSON.stringify(ev.message ?? ev)}`);
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
      const cb = coreEventListeners.get(type);
      if (cb) {
        coreEventListeners.delete(type);
        cb(ev);
      }

      // If there's an error event, reject all waiting promises that aren't specifically waiting for "error"
      if (type === "error") {
        console.error("[Core] Emitted error:", ev);
        for (const [key, listener] of coreEventListeners.entries()) {
          if (key !== "error") {
            // Pass the error event so the listener can reject
            listener(ev);
            coreEventListeners.delete(key);
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
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tid = setTimeout(() => {
      coreEventListeners.delete(type);
      reject(new Error(`[Core] timeout waiting for '${type}' event`));
    }, timeoutMs);
    coreEventListeners.set(type, (ev) => {
      clearTimeout(tid);
      if (ev.type === "error" && type !== "error") {
        reject(new Error(`[Core] Error: ${ev.message || "Unknown error"}`));
      } else {
        resolve(ev as T);
      }
    });
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
function waitForCoreReady(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Core ready timeout after 10 s")),
      10_000,
    );
    if (!coreProcess?.stdout) {
      reject(new Error("Core process has no stdout"));
      return;
    }
    startCoreEventLoop();
    coreEventListeners.set("ready", (ev) => {
      clearTimeout(timeout);
      const pipe = ev.pipe as string | undefined;
      if (!pipe) {
        reject(new Error("Ready event missing pipe field"));
        return;
      }
      console.log(
        `[Core] ready - version=${ev.version ?? "?"} pid=${ev.pid ?? "?"} pipe=${pipe}`,
      );
      resolve(pipe);
    });
  });
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
    // FFmpeg shared DLLs live next to the dev package headers/libs.
    const ffmpegBin =
      "C:\\ffmpeg-dev\\ffmpeg-n7.1-latest-win64-gpl-shared-7.1\\bin";
    spawnEnv.PATH = `${ffmpegBin};${spawnEnv.PATH ?? ""}`;
    spawnEnv.PATH = `${ffmpegBin};${spawnEnv.PATH ?? ""}`;
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
  coreProcess.stdin.write(JSON.stringify(cmd) + "\n");
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

const registerIpcHandlers = () => {
  ipcMain.handle("closeApp", (event) => {
    if (process.platform !== "darwin") {
      const win = BrowserWindow.fromWebContents(event.sender);
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
      // Broadcast to all renderer windows (editor + preview)
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("onOverlaysUpdated", activeOverlays);
      });
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
      if (win.webContents !== event.sender) {
        win.webContents.send("onAudioDataUpdated", visualizerId, dataArray);
      }
    });
  });

  ipcMain.on("sendAudioTime", (event, nodeId, currentTime, paused) => {
    // Broadcast to ALL windows including the sender — audio-node, now-playing-node,
    // and target-output-node all live in the same renderer window, so excluding
    // the sender would silently drop every update before it reaches the compositor.
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send("onAudioTimeUpdated", nodeId, currentTime, paused);
    });
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
        minWidth: 800,
        minHeight: 450,
        width: 1280,
        height: 720,
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
        sources: options.sources,
      });

      const ev = await waitForCoreEvent<{
        type: string;
        width: number;
        height: number;
      }>("stream_started", 15_000);
      nativeStreamStartAt = Date.now();
      console.log(`[Native stream] started ${ev.width}x${ev.height}`);
      return { success: true, width: ev.width, height: ev.height };
    },
  );

  ipcMain.handle("stopNativeStream", async () => {
    nativeStreamStartAt = null;
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

    return { success: true };
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
      devTools: inDevelopment,
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
});

app.on("before-quit", () => {
  stopCore();
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
