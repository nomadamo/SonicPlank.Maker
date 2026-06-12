import type { AudioMetadata } from "./utils/get-audio-data";

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
      onLog: (callback: (event: any, data: string) => void) => void;
      removeOnLog: (callback: (event: any, data: string) => void) => void;
    };
  }
}
