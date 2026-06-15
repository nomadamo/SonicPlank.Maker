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

// Force GPU rasterization and video decoding for the app
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-native-gpu-memory-buffers");
app.commandLine.appendSwitch("enable-accelerated-video-decode");
app.commandLine.appendSwitch("webrtc-max-cpu-consumption-percentage", "90");

let ffmpegProcess: any = null;
let activeOverlays: any[] = [];

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

// Handle squirrel startup checks
if (started) {
  app.quit();
}

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
    BrowserWindow.getAllWindows().forEach((win) => {
      if (win.webContents !== event.sender) {
        win.webContents.send("onAudioTimeUpdated", nodeId, currentTime, paused);
      }
    });
  });

  ipcMain.handle("startStream", (_event, rtmpUrl, options) => {
    try {
      if (ffmpegProcess) {
        ffmpegProcess.kill();
        ffmpegProcess = null;
      }

      const mode = options?.mode || "mjpeg";
      const encoder = options?.encoder || "libx264";
      const bitrateKbps = options?.bitrateKbps || 6000;
      const fps = options?.fps || 30;
      const width: number | null = options?.width || null;
      const height: number | null = options?.height || null;
      const bufsizeKbps = bitrateKbps * 2; // 2x bitrate for stable rate control

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
          "pipe:2",     // Force progress stats to stderr even in copy mode
          "-f",
          "h264",
          "-r",
          `${fps}`,
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

      // Input: JPEG frames piped from canvas compositor via stdin.
      // image2pipe + mjpeg codec reads one JPEG per frame — no container overhead,
      // no intermediate WebM encode (eliminates the previous double-encode bottleneck).
      const ffmpegArgs = [
        "-y",
        "-progress",
        "pipe:2",     // Force progress stats to stderr unconditionally
        "-f",
        "image2pipe",
        "-framerate",
        `${fps}`,
        "-vcodec",
        "mjpeg",
        "-i",
        "pipe:0",
      ];

      // Video encoding — single encode pass from raw JPEG frames to target codec.
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
        // Default / libx264 fallback — ultrafast preset for minimal CPU overhead
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

      // Output resolution scaling (GPU-side, no CPU cost).
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

  // Open the popout preview as a BrowserWindow in this same process.
  // Previously this spawned a separate Electron child process, which required
  // its own desktopCapturer.getSources() call and an IPC pipe for overlay/audio
  // sync. Running in-process means source IDs are already registered with
  // Chromium (from the editor's capture setup), overlays broadcast via the
  // existing BrowserWindow.getAllWindows() fans, and there's no child process
  // lifecycle to manage.
  ipcMain.handle("openPopOutPreview", (_event, args) => {
    const { sourceId, audio, width, height, aspect } = args;

    const params = new URLSearchParams();
    params.set("sourceId", String(sourceId));
    params.set("audio", String(audio));
    params.set("aspect", String(aspect || "auto"));
    if (width) params.set("maxWidth", String(width));
    if (height) params.set("maxHeight", String(height));

    const previewUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL
      ? `${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/preview?${params.toString()}`
      : `file://${path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`)}#/preview?${params.toString()}`;

    console.log("[Main] Opening popout preview window:", previewUrl);

    const previewWin = new BrowserWindow({
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
    previewWin.removeMenu();
    void previewWin.loadURL(previewUrl);

    if (inDevelopment) {
      previewWin.webContents.openDevTools();
    }

    // Push current overlays to the new window once its renderer is ready
    previewWin.webContents.once("did-finish-load", () => {
      previewWin.webContents.send("onOverlaysUpdated", activeOverlays);
    });
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

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.on("ready", () => {
  registerIpcHandlers();
  void createWindow();
});

// Quit when all windows are closed, except on macOS.
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
