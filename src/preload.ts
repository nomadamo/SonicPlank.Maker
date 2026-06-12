// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { AppControlProps, FileOpsProps } from "./utils/global";
import { contextBridge, ipcRenderer, webUtils } from "electron";

export type Channels = AppControlProps & FileOpsProps;

contextBridge.exposeInMainWorld("electron", {
  sendMessage(channel: Channels, args: unknown[]) {
    ipcRenderer.invoke(channel, args);
  },
  loadData: async (): Promise<string> => {
    const data = await ipcRenderer.invoke("readstorage");
    console.log("[Preload/loadData] Loaded");
    return data;
  },
  saveData: async (data: any): Promise<void> => {
    await ipcRenderer.invoke("savestorage", data);
    console.log("[Preload/saveData] Saved");
    return;
  },
  loadLibrary: async (): Promise<string> => {
    const data = await ipcRenderer.invoke("readlibrary");
    console.log("[Preload/loadLibrary] Loaded");
    return data;
  },
  saveLibrary: async (data: any): Promise<void> => {
    await ipcRenderer.invoke("savelibrary", data);
    console.log("[Preload/saveLibrary] Saved");
    return;
  },
  loadTimeline: async (): Promise<string> => {
    const data = await ipcRenderer.invoke("readtimeline");
    console.log("[Preload/loadTimeline] Loaded");
    return data;
  },
  saveTimeline: async (data: any): Promise<void> => {
    await ipcRenderer.invoke("savetimeline", data);
    console.log("[Preload/saveTimeline] Saved");
    return;
  },
  getAudioMetadata: async (filePath: string): Promise<any> => {
    const metadata = await ipcRenderer.invoke("getaudiometadata", filePath);
    return metadata;
  },
  openFileDialog: async (): Promise<string[]> => {
    const filePaths = await ipcRenderer.invoke("openfiledialog");
    return filePaths;
  },
  saveRecording: async (fileName: string, arrayBuffer: ArrayBuffer): Promise<string> => {
    const filePath = await ipcRenderer.invoke("saverecording", fileName, arrayBuffer);
    return filePath;
  },
  getFilePath: (file: any) => webUtils.getPathForFile(file),
  getScreenSources: async (options?: any): Promise<any[]> => {
    const sources = await ipcRenderer.invoke("getScreenSources", options);
    return sources;
  },
  onLog: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on("log", callback);
  },
  removeOnLog: (callback: (event: any, data: any) => void) => {
    ipcRenderer.removeListener("log", callback);
  },
});
