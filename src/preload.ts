// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

import { contextBridge, ipcRenderer, app } from 'electron';

export type Channels = "minimizeApp" | "maximizeApp" | "closeApp";

contextBridge.exposeInMainWorld('electron', {
  sendMessage(channel: Channels, args: unknown[]) {
    ipcRenderer.invoke(channel, args);
  },
})
