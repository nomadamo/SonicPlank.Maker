// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { AppControlProps, FileOpsProps } from '@utils/global';
import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';

export type Channels = AppControlProps & FileOpsProps;

contextBridge.exposeInMainWorld('electron', {
  sendMessage(channel: Channels, args: unknown[]) {
    ipcRenderer.invoke(channel, args);
  },
  loadData: async (): Promise<string> => {
    const data = await ipcRenderer.invoke('readstorage');
    console.log("[Preload/loadData] Data received:", data);
    return data;
  },
  saveData: async (data): Promise<void> => {
    await ipcRenderer.invoke('savestorage', data);
    console.log('[Preload/saveData] Completed');
    return;
  },
  onLog: (callback: (event: any, data: any) => void) => {
    ipcRenderer.on("log", callback);
  },
  removeOnLog: (callback: (event: any, data: any) => void) => {
    ipcRenderer.removeListener("log", callback);
  }
});
