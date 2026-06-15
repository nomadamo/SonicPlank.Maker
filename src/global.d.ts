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

export interface StreamStats {
  frame: number | null;
  fps: number | null;
  size: string | null;
  time: string | null;
  bitrate: string | null;
  speed: string | null;
  dropped: number | null;
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
      startStream: (rtmpUrl: string, options?: any) => Promise<{ success: boolean }>;
      stopStream: () => Promise<{ success: boolean }>;
      pushStreamData: (arrayBuffer: ArrayBuffer) => void;
      onOverlaysUpdated: (callback: (overlays: any[]) => void) => void;
      removeOnOverlaysUpdated: (callback: (overlays: any[]) => void) => void;
      onLog: (callback: (event: any, data: string) => void) => void;
      removeOnLog: (callback: (event: any, data: string) => void) => void;
      sendAudioData: (visualizerId: string, dataArray: number[]) => void;
      onAudioDataUpdated: (callback: (visualizerId: string, dataArray: number[]) => void) => void;
      removeOnAudioDataUpdated: () => void;
      openPopOutPreview: (args: { sourceId: string; audio: boolean; width: number; height: number; aspect: string }) => Promise<void>;
      getAvailableThemes: () => Promise<any[]>;
      loadThemeStyles: (themeName: string) => Promise<string>;
      sendAudioTime: (nodeId: string, currentTime: number, paused: boolean) => void;
      onAudioTimeUpdated: (callback: (nodeId: string, currentTime: number, paused: boolean) => void) => void;
      removeOnAudioTimeUpdated: () => void;
      onStreamStatus: (callback: (stats: StreamStats) => void) => void;
      removeOnStreamStatus: () => void;
    };
  }
}
