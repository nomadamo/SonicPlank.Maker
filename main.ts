import { app, BrowserWindow, ipcMain, session } from 'electron';
import { readData, writeData } from './utils/fileOperations';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { inDevelopment } from "./constants";


// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

const createWindow = async () => {

  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1400,
    height: 1000,
    autoHideMenuBar: true,
    minHeight: 1000,
    minWidth: 1400,
    titleBarStyle: 'hidden',
    titleBarOverlay: false,
    ...(process.platform !== 'darwin' ? {} : {}),
    webPreferences: {
      devTools: inDevelopment,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false // Disables the "Not allowed to load" check
    },
  });

  mainWindow.removeMenu();
  // and load the index.html of the app.
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    await mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
  } else {
    await mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  const reactDevToolsPath = path.join('C:\\Users\\voidd\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Extensions\\fmkadmapgofadopljbjfkapdkoienihi\\7.0.1_0');

  // Open the DevTools.
  if (inDevelopment) {

    mainWindow.webContents.openDevTools();
  }

  ipcMain.handle('closeApp', () => {
    if (process.platform !== 'darwin') {
      mainWindow.close();
    }
  })

  ipcMain.handle('minimizeApp', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('toggleDevTools', () => {
    mainWindow?.webContents.toggleDevTools();
  });

  ipcMain.handle('maximizeApp', () => {
    if(mainWindow.isMaximized()) {
        mainWindow.unmaximize();
    } else {
        mainWindow.maximize();
    }
  });

  ipcMain.handle('log', (args) =>{
    console.log("Log message received:", args);
  });

  ipcMain.handle('readstorage', () => {
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

  ipcMain.handle('savestorage', (data) => {
    try {
      writeData(data);
    } catch (error) {
      console.error("There was an error saving flowData:", error);
      throw error;
    }
  })

  app.setAboutPanelOptions({
    applicationName: "SonicPlank.Maker",
    credits: "Damon Batey",
    applicationVersion: "0.1.0",
    version: "0.1.0",
    copyright: "2026"
  });

  void app.whenReady().then(async () => {
    await session.defaultSession.extensions.loadExtension(reactDevToolsPath)
  })
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
   createWindow()

  //    window.electron.on('writeStorage', (event, data) => {
  //   writeData(data);
  // });

});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    void createWindow();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
