import type { AudioMetadata } from "./utils/get-audio-data";

export interface ScreenCaptureSource {
  id: string;
  name: string;
  thumbnailUrl: string;
  appIconUrl: string | null;
}

export interface DisplayInfo {
  id: number;
  bounds: { x: number; y: number; width: number; height: number };
  scaleFactor: number;
  isPrimary: boolean;
}

declare global {
  interface Window {
    electron: {
      sendMessage: (message: string, args: unknown[]) => void;
      loadData: () => Promise<string>;
      saveData: (data: string) => Promise<void>;
      loadLibrary: () => Promise<string>;
      saveLibrary: (data: any) => Promise<void>;
      loadTimeline: () => Promise<string>;
      saveTimeline: (data: any) => Promise<void>;
      getAudioMetadata: (filePath: string) => Promise<AudioMetadata>;
      openFileDialog: (options?: any) => Promise<string[]>;
      saveRecording: (fileName: string, arrayBuffer: ArrayBuffer, customPath?: string) => Promise<string>;
      getFilePath: (file: File) => string;
      getScreenSources: (options?: any) => Promise<ScreenCaptureSource[]>;
      getDisplays: () => Promise<DisplayInfo[]>;
      setOverlays: (overlays: any[]) => Promise<void>;
      getOverlays: () => Promise<any[]>;
      startStream: (rtmpUrl: string) => Promise<{ success: boolean }>;
      stopStream: () => Promise<{ success: boolean }>;
      pushStreamData: (arrayBuffer: ArrayBuffer) => Promise<{ success: boolean }>;
      onOverlaysUpdated: (callback: (overlays: any[]) => void) => void;
      removeOnOverlaysUpdated: (callback: (overlays: any[]) => void) => void;
      onLog: (callback: (event: any, data: string) => void) => void;
      removeOnLog: (callback: (event: any, data: string) => void) => void;
      sendAudioData: (visualizerId: string, dataArray: number[]) => void;
      onAudioDataUpdated: (callback: (visualizerId: string, dataArray: number[]) => void) => void;
      removeOnAudioDataUpdated: () => void;
    };
  }
}
