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
  openFileDialog: async (options?: any): Promise<string[]> => {
    const filePaths = await ipcRenderer.invoke("openfiledialog", options);
    return filePaths;
  },
  saveRecording: async (
    fileName: string,
    arrayBuffer: ArrayBuffer,
    customPath?: string,
  ): Promise<string> => {
    const filePath = await ipcRenderer.invoke(
      "saverecording",
      fileName,
      arrayBuffer,
      customPath,
    );
    return filePath;
  },
  getFilePath: (file: any) => webUtils.getPathForFile(file),
  getScreenSources: async (options?: any): Promise<any[]> => {
    const sources = await ipcRenderer.invoke("getScreenSources", options);
    return sources;
  },
  getDisplays: async (): Promise<any[]> => {
    const displays = await ipcRenderer.invoke("getDisplays");
    return displays;
  },
  setOverlays: async (overlays: any[]): Promise<void> => {
    await ipcRenderer.invoke("setOverlays", overlays);
  },
  getOverlays: async (): Promise<any[]> => {
    const res = await ipcRenderer.invoke("getOverlays");
    return res;
  },
  startStream: async (rtmpUrl: string, options?: any): Promise<{ success: boolean }> => {
    const res = await ipcRenderer.invoke("startStream", rtmpUrl, options);
    return res;
  },
  stopStream: async (): Promise<{ success: boolean }> => {
    const res = await ipcRenderer.invoke("stopStream");
    return res;
  },
  pushStreamData: async (
    arrayBuffer: ArrayBuffer,
  ): Promise<{ success: boolean }> => {
    const res = await ipcRenderer.invoke("pushStreamData", arrayBuffer);
    return res;
  },
  initPreviewWindow: async (width: number, height: number): Promise<number> => {
    const windowHandle = ipcRenderer.invoke(
      "initPreviewWindow",
      width,
      height,
    ) as Promise<number>;
    return windowHandle;
  },
  onOverlaysUpdated: (callback: (overlays: any[]) => void) => {
    ipcRenderer.on("onOverlaysUpdated", (_event, overlays) =>
      callback(overlays),
    );
  },
  removeOnOverlaysUpdated: (callback: (overlays: any[]) => void) => {
    ipcRenderer.removeAllListeners("onOverlaysUpdated");
  },
  onLog: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on("log", callback);
  },
  removeOnLog: (callback: (event: any, data: any) => void) => {
    ipcRenderer.removeListener("log", callback);
  },
  sendAudioData: (visualizerId: string, dataArray: number[]) => {
    ipcRenderer.send("sendAudioData", visualizerId, dataArray);
  },
  onAudioDataUpdated: (
    callback: (visualizerId: string, dataArray: number[]) => void,
  ) => {
    ipcRenderer.on("onAudioDataUpdated", (_event, visualizerId, dataArray) => {
      callback(visualizerId, dataArray);
    });
  },
  removeOnAudioDataUpdated: () => {
    ipcRenderer.removeAllListeners("onAudioDataUpdated");
  },
  openPopOutPreview: async (args: {
    sourceId: string;
    audio: boolean;
    width: number;
    height: number;
    aspect: string;
  }): Promise<void> => {
    await ipcRenderer.invoke("openPopOutPreview", args);
  },
  getAvailableThemes: async (): Promise<any[]> => {
    return await ipcRenderer.invoke("getAvailableThemes");
  },
  loadThemeStyles: async (themeName: string): Promise<string> => {
    return await ipcRenderer.invoke("loadThemeStyles", themeName);
  },
  sendAudioTime: (nodeId: string, currentTime: number, paused: boolean) => {
    ipcRenderer.send("sendAudioTime", nodeId, currentTime, paused);
  },
  onAudioTimeUpdated: (
    callback: (nodeId: string, currentTime: number, paused: boolean) => void,
  ) => {
    ipcRenderer.on("onAudioTimeUpdated", (_event, nodeId, currentTime, paused) => {
      callback(nodeId, currentTime, paused);
    });
  },
  removeOnAudioTimeUpdated: () => {
    ipcRenderer.removeAllListeners("onAudioTimeUpdated");
  },
  onStreamStatus: (callback: (stats: any) => void) => {
    ipcRenderer.on("onStreamStatus", (_event, stats) => callback(stats));
  },
  removeOnStreamStatus: () => {
    ipcRenderer.removeAllListeners("onStreamStatus");
  },
});
