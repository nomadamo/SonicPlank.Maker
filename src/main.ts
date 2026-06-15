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
import contextMenu from "electron-context-menu";
import os from "node:os";
import net from "node:net";

// Force GPU rasterization and video decoding for the app
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-native-gpu-memory-buffers");
app.commandLine.appendSwitch("enable-accelerated-video-decode"); // Hardware-accelerated decoding
app.commandLine.appendSwitch("webrtc-max-cpu-consumption-percentage", "90");

let ffmpegProcess: any = null;
let activeOverlays: any[] = [];

// Parse custom arguments passed to the child process
function getArgValue(prefix: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

const isPreviewMode = process.argv.includes("--preview-mode");

const previewCacheDir = path.join(app.getPath("userData"), "PreviewCache");

function cleanPreviewCache() {
  if (fs.existsSync(previewCacheDir)) {
    try {
      fs.rmSync(previewCacheDir, { recursive: true, force: true });
      console.log("[Main] Cleaned up PreviewCache directory successfully.");
    } catch (err) {
      console.error("[Main] Failed to clean up PreviewCache directory:", err);
    }
  }
  try {
    fs.mkdirSync(previewCacheDir, { recursive: true });
  } catch (err) {
    console.error("[Main] Failed to create PreviewCache directory:", err);
  }
}

if (isPreviewMode) {
  // Use a separate userData folder for the preview child process to prevent file lock deadlocks
  app.setPath("userData", previewCacheDir);
} else {
  // Clear the preview cache directory on editor startup to prevent cache bloating and stale locks
  cleanPreviewCache();
}

// IPC pipe/socket setup
const PIPE_PATH =
  process.platform === "win32"
    ? "\\\\.\\pipe\\sonicplank-preview-ipc"
    : path.join(os.tmpdir(), "sonicplank-preview-ipc.sock");

let previewChildProcess: any = null;
let activeSocket: net.Socket | null = null;

// Helper to send messages to the child process
function sendToChild(msg: { type: string; [key: string]: any }) {
  if (activeSocket && !activeSocket.destroyed) {
    try {
      activeSocket.write(JSON.stringify(msg) + "\n");
    } catch (err) {
      console.error("[Main IPC] Failed to write to socket:", err);
    }
  }
}

// 1. If we are in the main editor process, start the IPC server
if (!isPreviewMode) {
  if (process.platform !== "win32" && fs.existsSync(PIPE_PATH)) {
    try {
      fs.unlinkSync(PIPE_PATH);
    } catch (e) {
      // Ignore
    }
  }

  const ipcServer = net.createServer((socket) => {
    console.log("[IPC Server] Preview child process connected.");
    activeSocket = socket;

    // Send current overlays state instantly
    sendToChild({ type: "overlays", data: activeOverlays });

    let buffer = "";
    socket.on("data", (data) => {
      buffer += data.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === "setOverlays") {
            activeOverlays = msg.data;
            // Broadcast the updated overlays configuration to all editor renderer windows
            BrowserWindow.getAllWindows().forEach((win) => {
              win.webContents.send("onOverlaysUpdated", activeOverlays);
            });
          }
        } catch (err) {
          console.error("[IPC Server] Error parsing line from child:", err);
        }
      }
    });

    socket.on("close", () => {
      console.log("[IPC Server] Preview child process disconnected.");
      if (activeSocket === socket) activeSocket = null;
    });

    socket.on("error", (err) => {
      console.error("[IPC Server] Socket error:", err);
    });
  });

  ipcServer.listen(PIPE_PATH, () => {
    console.log("[IPC Server] Listening on", PIPE_PATH);
  });
}

// 2. Child process IPC client setup
let childSocket: net.Socket | null = null;

function connectToIpcServer(win: BrowserWindow) {
  childSocket = net.createConnection(PIPE_PATH, () => {
    console.log("[Child IPC Client] Connected to main editor process!");
  });

  let buffer = "";
  childSocket.on("data", (data) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === "overlays") {
          activeOverlays = msg.data;
          win.webContents.send("onOverlaysUpdated", activeOverlays);
        } else if (msg.type === "audioData") {
          win.webContents.send("onAudioDataUpdated", msg.id, msg.data);
        } else if (msg.type === "audioTime") {
          win.webContents.send(
            "onAudioTimeUpdated",
            msg.id,
            msg.currentTime,
            msg.paused,
          );
        }
      } catch (err) {
        console.error("[Child IPC Client] Error parsing line:", err);
      }
    }
  });

  childSocket.on("error", (err) => {
    console.error("[Child IPC Client] Socket error:", err);
    // Retry connection after 1 second
    setTimeout(() => {
      if (!win.isDestroyed()) connectToIpcServer(win);
    }, 1000);
  });

  childSocket.on("close", () => {
    console.log("[Child IPC Client] Socket closed.");
  });
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

  // Create default theme if none exists
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

// Child process preview spawn utility
function spawnPreviewProcess(args: {
  sourceId: string;
  audio: boolean;
  width: number;
  height: number;
  aspect: string;
}) {
  if (previewChildProcess) {
    try {
      previewChildProcess.kill();
    } catch (e) {
      // Ignore
    }
    previewChildProcess = null;
  }

  const execArgs = [
    ...process.argv
      .slice(1)
      .filter(
        (arg) =>
          !arg.startsWith("--preview-mode") &&
          !arg.startsWith("--source-id") &&
          !arg.startsWith("--remote-debugging-port"),
      ),
    "--preview-mode",
    `--source-id=${args.sourceId}`,
    `--audio=${args.audio}`,
    `--max-width=${args.width}`,
    `--max-height=${args.height}`,
    `--aspect=${args.aspect}`,
  ];

  console.log(
    "[Main] Spawning preview child process:",
    process.execPath,
    execArgs.join(" "),
  );

  previewChildProcess = spawn(process.execPath, execArgs, {
    env: { ...process.env },
    detached: true,
  });

  previewChildProcess.stdout?.on("data", (data: any) => {
    console.log(`[Preview Process stdout] ${data}`);
  });

  previewChildProcess.stderr?.on("data", (data: any) => {
    console.error(`[Preview Process stderr] ${data}`);
  });

  previewChildProcess.on("close", (code: number) => {
    console.log(`[Preview Process] Exited with code ${code}`);
    previewChildProcess = null;
    cleanPreviewCache();
  });
}

// Child process preview window creator
const createPreviewWindow = async () => {
  const previewSourceId = getArgValue("--source-id=") || "";
  const previewAudio = getArgValue("--audio=") === "true";
  const previewMaxWidth = getArgValue("--max-width=") || "";
  const previewMaxHeight = getArgValue("--max-height=") || "";
  const previewAspect = getArgValue("--aspect=") || "auto";

  const startUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL
    ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/preview?sourceId=${previewSourceId}&audio=${previewAudio}&maxWidth=${previewMaxWidth}&maxHeight=${previewMaxHeight}&aspect=${previewAspect}`
    : `file://${path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)}#/preview?sourceId=${previewSourceId}&audio=${previewAudio}&maxWidth=${previewMaxWidth}&maxHeight=${previewMaxHeight}&aspect=${previewAspect}`;

  console.log("[Preview Child Process] Launching window with URL:", startUrl);

  const previewWindow = new BrowserWindow({
    autoHideMenuBar: true,
    minWidth: 800,
    minHeight: 450,
    width: 1280,
    height: 720,
    webPreferences: {
      devTools: inDevelopment,
      preload: path.join(__dirname, "preload.js"),
      webSecurity: false,
    },
  });

  previewWindow.removeMenu();
  await previewWindow.loadURL(startUrl);

  if (inDevelopment) {
    previewWindow.webContents.openDevTools();
  }

  // Connect client socket
  connectToIpcServer(previewWindow);
};

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
      // Broadcast the updated overlays configuration to all renderer windows
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("onOverlaysUpdated", activeOverlays);
      });
      // Synchronise overlays with child process preview or back to editor parent
      if (isPreviewMode) {
        if (childSocket && !childSocket.destroyed) {
          childSocket.write(
            JSON.stringify({ type: "setOverlays", data: activeOverlays }) +
              "\n",
          );
        }
      } else {
        sendToChild({ type: "overlays", data: activeOverlays });
      }
    } catch (error) {
      console.error("Failed to propagate overlays:", error);
      throw error;
    }
  });

  ipcMain.handle("getOverlays", () => {
    return activeOverlays;
  });

  const lastSentMap = new Map<string, number>();

  ipcMain.on("sendAudioData", (event, visualizerId, dataArray) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win.webContents !== event.sender) {
        win.webContents.send("onAudioDataUpdated", visualizerId, dataArray);
      }
    });
    // Send to child process (throttled to max ~50fps)
    const now = Date.now();
    const lastSent = lastSentMap.get(visualizerId) || 0;
    if (now - lastSent >= 20) {
      lastSentMap.set(visualizerId, now);
      sendToChild({ type: "audioData", id: visualizerId, data: dataArray });
    }
  });

  ipcMain.on("sendAudioTime", (event, nodeId, currentTime, paused) => {
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win.webContents !== event.sender) {
        win.webContents.send("onAudioTimeUpdated", nodeId, currentTime, paused);
      }
    });
    // Send to child process (throttled to max ~30fps)
    const now = Date.now();
    const lastSent = lastSentMap.get(nodeId + "_time") || 0;
    if (now - lastSent >= 33) {
      lastSentMap.set(nodeId + "_time", now);
      sendToChild({ type: "audioTime", id: nodeId, currentTime, paused });
    }
  });

  ipcMain.handle("startStream", (_event, rtmpUrl, options) => {
    try {
      if (ffmpegProcess) {
        ffmpegProcess.kill();
        ffmpegProcess = null;
      }

      const encoder = options?.encoder || "libx264";
      const bitrateKbps = options?.bitrateKbps || 6000;
      const fps = options?.fps || 30;
      const bufsizeKbps = bitrateKbps * 2; // 2x bitrate for stable rate control

      console.log(
        `Starting FFmpeg RTMP stream to ${rtmpUrl} | encoder: ${encoder} | bitrate: ${bitrateKbps}k | ${fps}fps`,
      );

      // Input: JPEG frames piped from canvas compositor via stdin.
      // image2pipe + mjpeg codec reads one JPEG per frame — no container overhead,
      // no intermediate WebM encode (eliminates the previous double-encode bottleneck).
      const ffmpegArgs = [
        "-y",
        "-f", "image2pipe",
        "-framerate", `${fps}`,
        "-vcodec", "mjpeg",
        "-i", "pipe:0",
      ];

      // Video encoding — single encode pass from raw JPEG frames to target codec.
      // 'copy' is not valid here (JPEG → FLV requires a transcode), so we default
      // to libx264 ultrafast when no GPU encoder is selected.
      if (encoder === "h264_nvenc") {
        ffmpegArgs.push(
          "-c:v", "h264_nvenc",
          "-preset", "p4",           // balanced quality/speed (NVENC SDK preset)
          "-pix_fmt", "yuv420p",
          "-b:v", `${bitrateKbps}k`,
          "-maxrate:v", `${bitrateKbps}k`,
          "-bufsize:v", `${bufsizeKbps}k`,
          "-g", `${fps * 2}`,        // keyframe every 2 seconds
        );
      } else if (encoder === "h264_amf") {
        ffmpegArgs.push(
          "-c:v", "h264_amf",
          "-pix_fmt", "yuv420p",
          "-b:v", `${bitrateKbps}k`,
          "-maxrate:v", `${bitrateKbps}k`,
          "-bufsize:v", `${bufsizeKbps}k`,
          "-g", `${fps * 2}`,
        );
      } else if (encoder === "h264_qsv") {
        ffmpegArgs.push(
          "-c:v", "h264_qsv",
          "-pix_fmt", "yuv420p",
          "-b:v", `${bitrateKbps}k`,
          "-maxrate:v", `${bitrateKbps}k`,
          "-bufsize:v", `${bufsizeKbps}k`,
          "-g", `${fps * 2}`,
        );
      } else {
        // Default / libx264 fallback — ultrafast preset for minimal CPU overhead
        ffmpegArgs.push(
          "-c:v", "libx264",
          "-preset", "ultrafast",
          "-threads", "0",
          "-pix_fmt", "yuv420p",
          "-b:v", `${bitrateKbps}k`,
          "-maxrate:v", `${bitrateKbps}k`,
          "-bufsize:v", `${bufsizeKbps}k`,
          "-g", `${fps * 2}`,
        );
      }

      // Audio: no audio tracks in the current canvas pipeline.
      // -an suppresses the "Output file does not contain any stream" warning.
      ffmpegArgs.push("-an", "-f", "flv", rtmpUrl);

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

        if (fpsMatch || bitrateMatch) {
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

      return { success: true };
    } catch (error: any) {
      console.error("Failed to start FFmpeg streaming process:", error);
      throw error;
    }
  });

  ipcMain.handle("stopStream", () => {
    try {
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

  // Fire-and-forget: renderer doesn't wait for ack, eliminating per-frame round-trip latency.
  // Using ipcMain.on + ipcRenderer.send instead of handle/invoke saves 1-5ms per frame.
  ipcMain.on("pushStreamData", (_event, arrayBuffer) => {
    try {
      if (ffmpegProcess && ffmpegProcess.stdin.writable) {
        ffmpegProcess.stdin.write(Buffer.from(arrayBuffer));
      }
    } catch (error: any) {
      console.error("Failed to push streaming buffer to FFmpeg:", error);
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
    const cleanId = path.basename(themeId); // Sanitize path traversal
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

  ipcMain.handle("openPopOutPreview", (_event, args) => {
    spawnPreviewProcess(args);
  });
};

const createWindow = async () => {
  // Create the browser window.
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
      webSecurity: false, // Disables the "Not allowed to load" check
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

  // and load the index.html of the app.
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

  // Open the DevTools.
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

  // Commented out React DevTools loading temporarily as it is a known cause of deadlocks/freezes
  // when native file dialogs are triggered in Electron on Windows.
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

// contextMenu({
//   prepend: (defaultActions, params, browserWindow) => [
//     {
//       label: "Shut the fuck up",
//       visible: true,
//       click: () => {
//         browserWindow.webContents.executeJavaScript(
//           `alert('Shut the fuck up')`,
//         );
//       },
//     },
//   ],
//   showInspectElement: false,
//   showSelectAll: false,
// });

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
  registerIpcHandlers();
  if (isPreviewMode) {
    createPreviewWindow();
  } else {
    createWindow();
  }
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (previewChildProcess) {
    try {
      previewChildProcess.kill();
    } catch (e) {
      // Ignore
    }
  }
  cleanPreviewCache();
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("quit", () => {
  if (previewChildProcess) {
    try {
      previewChildProcess.kill();
    } catch (e) {
      // Ignore
    }
  }
  cleanPreviewCache();
});

app.on("activate", () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
