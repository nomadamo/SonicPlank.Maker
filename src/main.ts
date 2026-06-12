import { app, BrowserWindow, desktopCapturer, dialog, ipcMain, session } from "electron";
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

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

app.disableHardwareAcceleration();

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

  ipcMain.handle("closeApp", () => {
    if (process.platform !== "darwin") {
      mainWindow.close();
    }
  });

  ipcMain.handle("minimizeApp", () => {
    mainWindow?.minimize();
  });

  ipcMain.handle("toggleDevTools", () => {
    mainWindow?.webContents.toggleDevTools();
  });

  ipcMain.handle("maximizeApp", () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.handle("log", (args) => {
    console.log("Log message received:", args);
  });

  ipcMain.handle("readstorage", () => {
    try {
      const data = readData();
      // console.log("Data read during readstorage:", data);
      return data;
      // console.log('dataReceive had active listeners:', hadResponse);
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

  ipcMain.handle("openfiledialog", async () => {
    let result: Electron.OpenDialogReturnValue;

    try {
      result = await dialog.showOpenDialog(mainWindow, {
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
      });
      return result?.canceled ? [] : result?.filePaths;
    } catch (error) {
      console.log(error);
    }
  });

  ipcMain.handle(
    "saverecording",
    async (_event, fileName: string, arrayBuffer: ArrayBuffer) => {
      try {
        const documentsPath = app.getPath("documents");
        const dirPath = path.join(
          documentsPath,
          "SonicPlank.Maker",
          "recordings",
        );
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

  ipcMain.handle(
    "getScreenSources",
    async (_event, options) => {
      try {
        const sources = await desktopCapturer.getSources(options || {
          types: ["screen", "window"],
          thumbnailSize: { width: 300, height: 200 }
        });
        return sources.map(source => ({
          id: source.id,
          name: source.name,
          thumbnailUrl: source.thumbnail.toDataURL(),
          appIconUrl: source.appIcon ? source.appIcon.toDataURL() : null,
        }));
      } catch (error) {
        console.error("Failed to get screen sources:", error);
        throw error;
      }
    }
  );

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

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
  createWindow();

  //    window.electron.on('writeStorage', (event, data) => {
  //   writeData(data);
  // });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
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
