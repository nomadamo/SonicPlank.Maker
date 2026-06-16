import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
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
    while (streamDelayBuffer.length > 0 && now - streamDelayBuffer[0].receivedAt >= streamDelayMs) {
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

  // Spawn FFmpeg with the given args and wire up the shared stdin-error /
  // stderr-stats-parsing / close handlers used by every streaming mode.
  function spawnFfmpegStream(ffmpegArgs: string[]) {
    ffmpegProcess = spawn("ffmpeg", ffmpegArgs);

    ffmpegProcess.stdin.on("error", (err: any) => {
      console.error("FFmpeg stdin error:", err);
    });

    ffmpegProcess.stderr.on("data", (data: any) => {
      const line: string = data.toString();
      console.log(`FFmpeg status: ${line}`);

      // Parse the progress line: frame= NNN fps= NN q=... size=...KiB time=... bitrate=...kbits/s speed=...x drop=NNN
      const frameMatch = line.match(/frame=\s*(\d+)/);
      const fpsMatch = line.match(/fps=\s*([\d.]+)/);
      const sizeMatch = line.match(/size=\s*([\d.]+\s*\w+)/);
      const timeMatch = line.match(/time=\s*([\d:.]+)/);
      const bitrateMatch = line.match(/bitrate=\s*([\d.]+\s*\w+\/s)/);
      const speedMatch = line.match(/speed=\s*([\d.]+x)/);
      const dropMatch = line.match(/drop=\s*(\d+)/);

      if (fpsMatch || bitrateMatch || frameMatch || timeMatch) {
        const stats = {
          frame: frameMatch ? parseInt(frameMatch[1]) : null,
          fps: fpsMatch ? parseFloat(fpsMatch[1]) : null,
          size: sizeMatch ? sizeMatch[1].trim() : null,
          time: timeMatch ? timeMatch[1].trim() : null,
          bitrate: bitrateMatch ? bitrateMatch[1].trim() : null,
          speed: speedMatch ? speedMatch[1].trim() : null,
          dropped: dropMatch ? parseInt(dropMatch[1]) : null,
        };
        BrowserWindow.getAllWindows().forEach((win) => {
          if (!win.isDestroyed()) win.webContents.send("onStreamStatus", stats);
        });
      }
    });

    ffmpegProcess.on("close", (code: number) => {
      console.log(`FFmpeg process exited with code ${code}`);
      ffmpegProcess = null;
    });
  }

  ipcMain.handle("startStream", (_event, rtmpUrl, options) => {
    try {
      if (ffmpegProcess) {
        ffmpegProcess.kill();
        ffmpegProcess = null;
      }

      const mode = options?.mode || "mjpeg";
      const encoder = options?.encoder || "libx264";
      const bitrateKbps = options?.bitrateKbps || 6000;
      const fps: number =
        Number((options as Record<string, unknown>)?.fps) || 30;
      const width: number | null = options?.width || null;
      const height: number | null = options?.height || null;
      const bufsizeKbps = bitrateKbps * 2;

      // Configure stream delay — frames are held in the delay buffer for this
      // many milliseconds before being written to FFmpeg stdin.
      streamDelayMs = Number((options as Record<string, unknown>)?.streamDelayMs) || 0;
      if (streamDelayMs > 0) {
        startDelayFlush();
      }

      // ── Mode: h264 ──────────────────────────────────────────────────────────
      // Frames are already encoded to H.264 on the GPU by the renderer's
      // WebCodecs VideoEncoder. FFmpeg only needs to mux to FLV — `-c:v copy`,
      // no decode, no re-encode (near-zero CPU). The FLV muxer auto-converts
      // the Annex-B bitstream to AVCC, so no bitstream filter is required.
      if (mode === "h264") {
        console.log(
          `Starting FFmpeg RTMP mux (WebCodecs H.264 passthrough) to ${rtmpUrl} | ${fps}fps`,
        );
        const ffmpegArgs = [
          "-y",
          "-progress",
          "pipe:2",
          // +genpts: generate PTS from the frame-count DTS assigned by -r. Without
          // this, raw H.264 demuxer passes AV_NOPTS_VALUE PTS through -c:v copy and
          // the FLV muxer reconstructs timing itself, causing time=N/A in progress
          // output and jitter in the RTMP stream.
          "-fflags",
          "+genpts",
          // Tell FFmpeg the input frame rate so it assigns monotonic DTS by frame
          // count (0, 1/fps, 2/fps, …) rather than by wall-clock arrival time.
          // Wall-clock timestamps cause non-monotonic DTS when the IPC between
          // the renderer and main process delivers chunks in bursts (which happens
          // under heavy compositing load like the visualizer) — the FLV muxer then
          // sees DTS go backward and emits continuous non-monotonic warnings.
          "-r",
          `${fps}`,
          "-f",
          "h264",
          "-i",
          "pipe:0",
          "-c:v",
          "copy",
          "-an",
          "-f",
          "flv",
          rtmpUrl,
        ];
        spawnFfmpegStream(ffmpegArgs);
        return { success: true };
      }

      // ── Mode: mjpeg (fallback) ──────────────────────────────────────────────
      const resLabel = width && height ? ` | output: ${width}x${height}` : "";
      console.log(
        `Starting FFmpeg RTMP stream to ${rtmpUrl} | encoder: ${encoder} | bitrate: ${bitrateKbps}k | ${fps}fps${resLabel}`,
      );

      const ffmpegArgs = [
        "-y",
        "-progress",
        "pipe:2",
        "-f",
        "image2pipe",
        "-framerate",
        `${fps}`,
        "-vcodec",
        "mjpeg",
        "-i",
        "pipe:0",
      ];

      if (encoder === "h264_nvenc") {
        ffmpegArgs.push(
          "-c:v",
          "h264_nvenc",
          "-preset",
          "p4",
          "-pix_fmt",
          "yuv420p",
          "-b:v",
          `${bitrateKbps}k`,
          "-maxrate:v",
          `${bitrateKbps}k`,
          "-bufsize:v",
          `${bufsizeKbps}k`,
          "-g",
          `${fps * 2}`,
        );
      } else if (encoder === "h264_amf") {
        ffmpegArgs.push(
          "-c:v",
          "h264_amf",
          "-pix_fmt",
          "yuv420p",
          "-b:v",
          `${bitrateKbps}k`,
          "-maxrate:v",
          `${bitrateKbps}k`,
          "-bufsize:v",
          `${bufsizeKbps}k`,
          "-g",
          `${fps * 2}`,
        );
      } else if (encoder === "h264_qsv") {
        ffmpegArgs.push(
          "-c:v",
          "h264_qsv",
          "-pix_fmt",
          "yuv420p",
          "-b:v",
          `${bitrateKbps}k`,
          "-maxrate:v",
          `${bitrateKbps}k`,
          "-bufsize:v",
          `${bufsizeKbps}k`,
          "-g",
          `${fps * 2}`,
        );
      } else {
        ffmpegArgs.push(
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-threads",
          "0",
          "-pix_fmt",
          "yuv420p",
          "-b:v",
          `${bitrateKbps}k`,
          "-maxrate:v",
          `${bitrateKbps}k`,
          "-bufsize:v",
          `${bufsizeKbps}k`,
          "-g",
          `${fps * 2}`,
        );
      }

      if (width && height && width > 0 && height > 0) {
        const w = Math.round(width / 2) * 2;
        const h = Math.round(height / 2) * 2;
        ffmpegArgs.push("-vf", `scale=${w}:${h}:flags=lanczos`);
      }

      ffmpegArgs.push("-an", "-f", "flv", rtmpUrl);

      spawnFfmpegStream(ffmpegArgs);

      return { success: true };
    } catch (error: any) {
      console.error("Failed to start FFmpeg streaming process:", error);
      throw error;
    }
  });

  ipcMain.handle("stopStream", () => {
    try {
      // Flush any buffered frames before closing — preserves content queued
      // in the delay buffer so the last N seconds reach the RTMP server.
      stopDelayFlush(true);
      streamDelayMs = 0;
      if (ffmpegProcess) {
        ffmpegProcess.stdin.end();
        ffmpegProcess.kill();
        ffmpegProcess = null;
        console.log("FFmpeg RTMP stream stopped.");
      }
      return { success: true };
    } catch (error: any) {
      console.error("Failed to stop FFmpeg streaming process:", error);
      throw error;
    }
  });

  // Fire-and-forget write: ArrayBuffer was transferred from renderer (no GC copy).
  // With -r ${fps} on the FFmpeg input, DTS is assigned by frame count so
  // wall-clock arrival timing is irrelevant. When a delay is configured the
  // frame is queued and released by startDelayFlush's interval timer.
  ipcMain.on("pushStreamData", (_event, arrayBuffer) => {
    const buf = Buffer.from(arrayBuffer as ArrayBuffer);
    if (streamDelayMs > 0) {
      streamDelayBuffer.push({ data: buf, receivedAt: Date.now() });
    } else {
      try {
        const stdin = getStdin();
        if (stdin) stdin.write(buf);
      } catch (error) {
        console.error("Failed to push streaming buffer to FFmpeg:", error);
      }
    }
  });

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
    (_event, args: { aspect?: string } | undefined) => {
      if (previewWin && !previewWin.isDestroyed()) {
        previewWin.focus();
        return;
      }

      const aspect: string = args?.aspect ?? "16/9";
      const startUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL
        ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/preview?aspect=${encodeURIComponent(aspect)}`
        : `file://${path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)}#/preview?aspect=${encodeURIComponent(aspect)}`;

      console.log("[Main] Opening Edit Overlay window:", startUrl);

      previewWin = new BrowserWindow({
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

      // Send current overlays to the preview as soon as its renderer is ready
      previewWin.webContents.once("did-finish-load", () => {
        if (previewWin && !previewWin.isDestroyed()) {
          previewWin.webContents.send("onOverlaysUpdated", activeOverlays);
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

  // Editor sends JPEG-encoded compositor frames here; main relays directly to the
  // preview window. BroadcastChannel does not cross renderer-process boundaries in
  // Electron, so IPC relay is the only reliable transport for frame data.
  ipcMain.on(
    "sendPreviewFrame",
    (_event, buf: ArrayBuffer, width: number, height: number) => {
      if (previewWin && !previewWin.isDestroyed()) {
        previewWin.webContents.send("onPreviewFrame", buf, width, height);
      }
    },
  );

  // Preview window notifies main when it receives its first compositor frame.
  // Main relays to all other windows (the editor) so it can update its status dialog.
  ipcMain.on("editOverlayConnected", (event) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed() && win.webContents !== event.sender) {
        win.webContents.send("editOverlayConnected");
      }
    });
  });
};

const createWindow = async () => {
  const mainWindow = new BrowserWindow({
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
    "Extensions\\fmkadmapgofadopljbjfkapdkoienihi\\7.0.1_0",
  );

  if (inDevelopment) {
    mainWindow.webContents.openDevTools();
  }

  app.setAboutPanelOptions({
    applicationName: "SonicPlank.Maker",
    credits: "Damon Batey",
    applicationVersion: "0.1.0",
    version: "0.1.0",
    copyright: "2026",
  });

  if (fs.existsSync(reactDevToolsPath)) {
    try {
      await session.defaultSession.extensions.loadExtension(reactDevToolsPath);
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
};

app.on("ready", () => {
  registerIpcHandlers();
  void createWindow();
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
