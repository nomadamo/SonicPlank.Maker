// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { AppControlProps, FileOpsProps } from "./utils/global";
import { contextBridge, ipcRenderer, webUtils } from "electron";

export type Channels = AppControlProps & FileOpsProps;

// ── MessagePort state (preview frames only) ──────────────────────────────────
// Used for the compositor→preview renderer frame channel. Renderer-to-renderer
// ports travel through Chromium only and support ArrayBuffer transfer correctly.
// The stream data path uses ipcRenderer.send (Chromium→Node.js does not support
// ArrayBuffer transfer via MessagePortMain).

let previewSendPort: MessagePort | null = null;
let previewFrameCallback:
  | ((buf: ArrayBuffer, width: number, height: number) => void)
  | null = null;
let editOverlayClosedCallback: (() => void) | null = null;

// Receive the preview send port delivered by main after the preview window loads.
ipcRenderer.on("previewSendPort", (event) => {
  previewSendPort = event.ports[0] ?? null;
});

// Preview window side: receive the receive port and wire it to the callback.
ipcRenderer.on("previewReceivePort", (event) => {
  const port = event.ports[0];
  if (!port) return;
  port.start();
  port.onmessage = (e: MessageEvent) => {
    if (previewFrameCallback) {
      const { data, width, height } = e.data as {
        data: ArrayBuffer;
        width: number;
        height: number;
      };
      previewFrameCallback(data, width, height);
    }
  };
});

// When the preview window closes, release the send port — sending on a closed
// channel throws, and the next openEditOverlay will issue a fresh port pair.
ipcRenderer.on("editOverlayClosed", () => {
  previewSendPort = null;
  editOverlayClosedCallback?.();
});

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
  showSaveDialog: async (options: any): Promise<any> => {
    return await ipcRenderer.invoke("dialog:showSaveDialog", options);
  },
  showOpenDialog: async (options: any): Promise<any> => {
    return await ipcRenderer.invoke("dialog:showOpenDialog", options);
  },
  readProject: async (filePath: string): Promise<string | null> => {
    return await ipcRenderer.invoke("readProject", filePath);
  },
  saveProject: async (filePath: string, data: string): Promise<boolean> => {
    return await ipcRenderer.invoke("saveProject", filePath, data);
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
  getGpuList: async (): Promise<any[]> => {
    const list = await ipcRenderer.invoke("getGpuList");
    return list;
  },
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
  startStream: async (
    rtmpUrl: string,
    options?: any,
  ): Promise<{ success: boolean }> => {
    const res = await ipcRenderer.invoke("startStream", rtmpUrl, options);
    return res;
  },
  stopStream: async (): Promise<{ success: boolean }> => {
    const res = await ipcRenderer.invoke("stopStream");
    return res;
  },
  pushStreamData: (arrayBuffer: ArrayBuffer): void => {
    ipcRenderer.send("pushStreamData", arrayBuffer);
  },
  onOverlaysUpdated: (callback: (overlays: any[]) => void) => {
    ipcRenderer.on("onOverlaysUpdated", (_event, overlays) =>
      callback(overlays),
    );
  },
  removeOnOverlaysUpdated: (_callback: (overlays: any[]) => void) => {
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
  onNativeWindowClose: (callback: () => void) => {
    ipcRenderer.on("nativeWindowClose", callback);
  },
  removeOnNativeWindowClose: () => {
    ipcRenderer.removeAllListeners("nativeWindowClose");
  },
  sendChatMessages: (nodeId: string, messages: any[]) => {
    ipcRenderer.send("sendChatMessages", nodeId, messages);
  },
  getChatMessages: async (): Promise<Record<string, any[]>> => {
    return await ipcRenderer.invoke("getChatMessages");
  },
  connectTwitchChat: async (
    nodeId: string,
    channel: string,
    token: string,
    maxMessages: number,
  ): Promise<{ success: boolean; error?: string }> => {
    return await ipcRenderer.invoke("connectTwitchChat", nodeId, channel, token, maxMessages);
  },
  disconnectTwitchChat: async (nodeId: string): Promise<void> => {
    await ipcRenderer.invoke("disconnectTwitchChat", nodeId);
  },
  onChatMessagesUpdated: (
    callback: (nodeId: string, messages: any[]) => void,
  ) => {
    ipcRenderer.on("onChatMessagesUpdated", (_event, nodeId, messages) => {
      callback(nodeId, messages);
    });
  },
  removeOnChatMessagesUpdated: () => {
    ipcRenderer.removeAllListeners("onChatMessagesUpdated");
  },
  openEditOverlay: async (args: { aspect: string; fitMode?: string }): Promise<void> => {
    await ipcRenderer.invoke("openEditOverlay", args);
  },
  updateFitMode: async (fitMode: string): Promise<void> => {
    await ipcRenderer.invoke("updateFitMode", fitMode);
  },
  onFitModeUpdated: (callback: (fitMode: string) => void) => {
    ipcRenderer.on("onFitModeUpdated", (_event, fitMode) => callback(fitMode));
  },
  removeOnFitModeUpdated: () => {
    ipcRenderer.removeAllListeners("onFitModeUpdated");
  },
  onEditOverlayClosed: (callback: () => void) => {
    editOverlayClosedCallback = callback;
  },
  removeOnEditOverlayClosed: () => {
    editOverlayClosedCallback = null;
  },
  notifyEditOverlayConnected: () => {
    ipcRenderer.send("editOverlayConnected");
  },
  onEditOverlayConnected: (callback: () => void) => {
    ipcRenderer.on("editOverlayConnected", callback);
  },
  removeOnEditOverlayConnected: () => {
    ipcRenderer.removeAllListeners("editOverlayConnected");
  },
  sendPreviewFrame: (data: ArrayBuffer, width: number, height: number) => {
    if (previewSendPort) {
      previewSendPort.postMessage({ data, width, height }, [data]);
    }
  },
  onPreviewFrame: (
    callback: (data: ArrayBuffer, width: number, height: number) => void,
  ) => {
    previewFrameCallback = callback;
  },
  removeOnPreviewFrame: () => {
    previewFrameCallback = null;
  },
  getAvailableThemes: async (): Promise<any[]> => {
    return await ipcRenderer.invoke("getAvailableThemes");
  },
  loadThemeStyles: async (themeName: string): Promise<string> => {
    return await ipcRenderer.invoke("loadThemeStyles", themeName);
  },
  installOverlayTheme: async (filePath: string): Promise<any> => {
    return await ipcRenderer.invoke("installOverlayTheme", filePath);
  },
  getInstalledOverlayThemes: async (): Promise<any[]> => {
    return await ipcRenderer.invoke("getInstalledOverlayThemes");
  },
  loadOverlayTheme: async (themeId: string): Promise<any> => {
    return await ipcRenderer.invoke("loadOverlayTheme", themeId);
  },
  saveOverlayTheme: async (args: { themeJson: string; assets: { localPath: string; archiveName: string }[]; savePath: string }): Promise<any> => {
    return await ipcRenderer.invoke("saveOverlayTheme", args);
  },
  openThemeForEditing: async (filePath: string): Promise<any> => {
    return await ipcRenderer.invoke("openThemeForEditing", filePath);
  },
  sendAudioTime: (nodeId: string, currentTime: number, paused: boolean) => {
    ipcRenderer.send("sendAudioTime", nodeId, currentTime, paused);
  },
  onAudioTimeUpdated: (
    callback: (nodeId: string, currentTime: number, paused: boolean) => void,
  ) => {
    ipcRenderer.on(
      "onAudioTimeUpdated",
      (_event, nodeId, currentTime, paused) => {
        callback(nodeId, currentTime, paused);
      },
    );
  },
  removeOnAudioTimeUpdated: () => {
    ipcRenderer.removeAllListeners("onAudioTimeUpdated");
  },
  onOverlayRemoved: (callback: (id: string) => void) => {
    ipcRenderer.on("overlay-removed", (_event, id) => callback(id));
  },
  removeOnOverlayRemoved: () => {
    ipcRenderer.removeAllListeners("overlay-removed");
  },
  setOverlayResolution: (width: number, height: number) => {
    return ipcRenderer.invoke("setOverlayResolution", width, height);
  },
  onStreamStatus: (callback: (stats: any) => void) => {
    ipcRenderer.on("onStreamStatus", (_event, stats) => callback(stats));
  },
  removeOnStreamStatus: () => {
    ipcRenderer.removeAllListeners("onStreamStatus");
  },
  onAudioLevel: (callback: (peakDb: number) => void) => {
    ipcRenderer.on("onAudioLevel", (_event, peakDb) => callback(peakDb));
  },
  removeOnAudioLevel: () => {
    ipcRenderer.removeAllListeners("onAudioLevel");
  },
  initiateSpotifyAuth: async (): Promise<{
    accessToken: string;
    refreshToken: string;
    expiresIn: number;
  }> => {
    return await ipcRenderer.invoke("initiateSpotifyAuth");
  },

  // ── Native preview (Phase 1) ──────────────────────────────────────────────
  getPreviewSources: async (): Promise<
    { id: string; name: string; kind: "monitor" | "window" }[]
  > => {
    return await ipcRenderer.invoke("getPreviewSources");
  },
  getAudioDevices: async (): Promise<
    { id: string; name: string; is_input: boolean; is_default: boolean }[]
  > => {
    return await ipcRenderer.invoke("getAudioDevices");
  },
  getWaveformPeaks: async (path: string, pixelsPerSecond: number): Promise<number[]> => {
    return await ipcRenderer.invoke("getWaveformPeaks", path, pixelsPerSecond);
  },
  startPreviewCapture: async (sourceId: string): Promise<void> => {
    await ipcRenderer.invoke("startPreviewCapture", sourceId);
  },
  stopPreviewCapture: (sourceId: string) => {
    return ipcRenderer.invoke("stopPreviewCapture", sourceId);
  },
  setCoreConfig: async (sources: any[]): Promise<void> => {
    await ipcRenderer.invoke("setCoreConfig", sources);
  },
  onNativePreviewFrame: (
    callback: (sourceId: string, width: number, height: number, data: Uint8Array) => void,
  ) => {
    ipcRenderer.on(
      "onNativePreviewFrame",
      (_event, sourceId, width, height, data) => callback(sourceId, width, height, data),
    );
  },
  removeOnNativePreviewFrame: (): void => {
    ipcRenderer.removeAllListeners("onNativePreviewFrame");
  },
  startNativeStream: async (
    options: {
      rtmpUrl: string;
      bitrateKbps?: number;
      fps?: number;
      outputWidth?: number;
      outputHeight?: number;
      fitMode?: string;
      encoder?: string;
      audioDeviceIds?: string[];
      sources: {
        source_id: string;
        is_primary: boolean;
        x_percent: number;
        y_percent: number;
        w_percent: number;
        h_percent: number;
      }[];
    },
  ): Promise<{ success: boolean; width: number; height: number }> => {
    return await ipcRenderer.invoke("startNativeStream", options);
  },
  stopNativeStream: async (): Promise<{ success: boolean }> => {
    return await ipcRenderer.invoke("stopNativeStream");
  },

  // ── Encoder config ──────────────────────────────────────────────────────────
  getEncoderConfig: async (): Promise<unknown> => {
    return await ipcRenderer.invoke("getEncoderConfig");
  },
  setEncoderConfig: async (config: unknown): Promise<void> => {
    await ipcRenderer.invoke("setEncoderConfig", config);
  },
});
