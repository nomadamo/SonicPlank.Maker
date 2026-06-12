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
      openFileDialog: () => Promise<string[]>;
      saveRecording: (fileName: string, arrayBuffer: ArrayBuffer) => Promise<string>;
      getFilePath: (file: File) => string;
      getScreenSources: (options?: any) => Promise<ScreenCaptureSource[]>;
      getDisplays: () => Promise<DisplayInfo[]>;
      onLog: (callback: (event: any, data: string) => void) => void;
      removeOnLog: (callback: (event: any, data: string) => void) => void;
    };
  }
}
