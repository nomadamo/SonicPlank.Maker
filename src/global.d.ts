import type { AudioMetadata } from "./utils/get-audio-data";
import type { OverlayThemeMeta, OverlayThemeLayout } from "./types/flow-node";
import type { VodStatus } from "./store/flowStore";

export interface SceneSwitchEvent {
  nodeId: string;
  sceneId: string;
  durationMs: number;
}

export interface SceneHotkeyRegistration {
  sceneId: string;
  hotkey: string;
  durationMs: number;
}

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
      showSaveDialog: (options: any) => Promise<any>;
      showOpenDialog: (options: any) => Promise<any>;
      readProject: (filePath: string) => Promise<string | null>;
      saveProject: (filePath: string, data: string) => Promise<boolean>;
      openFileDialog: (options?: any) => Promise<string[]>;
      saveRecording: (fileName: string, arrayBuffer: ArrayBuffer, customPath?: string) => Promise<string>;
      getFilePath: (file: File) => string;
      getScreenSources: (options?: any) => Promise<ScreenCaptureSource[]>;
      getDisplays: () => Promise<DisplayInfo[]>;
      getGpuList: () => Promise<string[]>;
      setOverlays: (overlays: any[]) => Promise<void>;
      getOverlays: () => Promise<any[]>;
      startStream: (rtmpUrl: string, options?: {
        mode?: string;
        encoder?: string;
        bitrateKbps?: number;
        fps?: number;
        width?: number;
        height?: number;
        streamDelayMs?: number;
      }) => Promise<{ success: boolean }>;
      stopStream: () => Promise<{ success: boolean }>;
      pushStreamData: (arrayBuffer: ArrayBuffer) => void;
      onOverlaysUpdated: (callback: (overlays: any[]) => void) => void;
      removeOnOverlaysUpdated: (callback: (overlays: any[]) => void) => void;
      onLog: (callback: (event: any, data: string) => void) => void;
      removeOnLog: (callback: (event: any, data: string) => void) => void;
      onOverlayRemoved: (callback: (id: string) => void) => void;
      removeOnOverlayRemoved: () => void;
      setOverlayResolution: (width: number, height: number) => Promise<void>;
      sendAudioData: (visualizerId: string, dataArray: number[]) => void;
      onAudioDataUpdated: (callback: (visualizerId: string, dataArray: number[]) => void) => void;
      removeOnAudioDataUpdated: () => void;
      onNativeWindowClose: (callback: () => void) => void;
      removeOnNativeWindowClose: () => void;
      sendChatMessages: (nodeId: string, messages: any[]) => void;
      getChatMessages: () => Promise<Record<string, any[]>>;
      connectTwitchChat: (nodeId: string, channel: string, token: string, maxMessages: number) => Promise<{ success: boolean; error?: string }>;
      disconnectTwitchChat: (nodeId: string) => Promise<void>;
      onChatMessagesUpdated: (callback: (nodeId: string, messages: any[]) => void) => void;
      removeOnChatMessagesUpdated: () => void;
      openEditOverlay: (args: { aspect: string; fitMode?: string }) => Promise<void>;
      updateFitMode: (fitMode: string) => Promise<void>;
      onFitModeUpdated: (callback: (fitMode: string) => void) => void;
      removeOnFitModeUpdated: () => void;
      onEditOverlayClosed: (callback: () => void) => void;
      removeOnEditOverlayClosed: () => void;
      notifyEditOverlayConnected: () => void;
      onEditOverlayConnected: (callback: () => void) => void;
      removeOnEditOverlayConnected: () => void;
      sendPreviewFrame: (buf: ArrayBuffer, width: number, height: number) => void;
      onPreviewFrame: (callback: (buf: ArrayBuffer, width: number, height: number) => void) => void;
      removeOnPreviewFrame: () => void;
      getAvailableThemes: () => Promise<any[]>;
      loadThemeStyles: (themeName: string) => Promise<string>;
      installOverlayTheme: (filePath: string) => Promise<OverlayThemeMeta | { error: string }>;
      uninstallOverlayTheme: (themeId: string) => Promise<{ success: boolean; error?: string }>;
      getInstalledOverlayThemes: () => Promise<OverlayThemeMeta[]>;
      loadOverlayTheme: (themeId: string) => Promise<OverlayThemeLayout | null>;
      saveOverlayTheme: (args: { themeJson: string; assets: { localPath: string; archiveName: string }[]; savePath: string }) => Promise<{ success: boolean; error?: string }>;
      openThemeForEditing: (filePath: string) => Promise<{ themeJson: string; tmpDir: string } | { error: string }>;
      sendAudioTime: (nodeId: string, currentTime: number, paused: boolean) => void;
      onAudioTimeUpdated: (callback: (nodeId: string, currentTime: number, paused: boolean) => void) => void;
      removeOnAudioTimeUpdated: () => void;
      onStreamStatus: (callback: (stats: StreamStats) => void) => void;
      removeOnStreamStatus: () => void;
      onAudioLevel: (callback: (peakDb: number) => void) => void;
      removeOnAudioLevel: () => void;
      initiateSpotifyAuth: () => Promise<{
        accessToken: string;
        refreshToken: string;
        expiresIn: number;
      }>;
      initiateYoutubeAuth: (opts: { clientId: string; clientSecret: string }) => Promise<{ refreshToken: string }>;
      // Native preview (Phase 1)
      getPreviewSources: () => Promise<NativeCaptureSource[]>;
      startPreviewCapture: (sourceId: string) => Promise<void>;
      stopPreviewCapture: (sourceId: string) => Promise<void>;
      setCoreConfig: (sources: any[]) => Promise<void>;
      onNativePreviewFrame: (
        callback: (sourceId: string, width: number, height: number, data: Uint8Array) => void,
      ) => void;
      removeOnNativePreviewFrame: () => void;
      getAudioDevices: () => Promise<{ id: string; name: string; kind: "output" | "microphone" | "capture"; is_default: boolean }[]>;
      getWaveformPeaks: (path: string, pixelsPerSecond: number) => Promise<number[]>;
      startNativeStream: (
        options: {
          rtmpUrl: string;
          bitrateKbps?: number;
          fps?: number;
          outputWidth?: number;
          outputHeight?: number;
          fitMode?: string;
          encoder?: string;
          audioDeviceIds?: string[];
          recordPath?: string;
          twitchToken?: string;
          youtubeClientId?: string;
          youtubeClientSecret?: string;
          youtubeRefreshToken?: string;
          youtubeAutoUpload?: boolean;
          sources: {
            source_id: string;
            is_primary: boolean;
            x_percent: number;
            y_percent: number;
            w_percent: number;
            h_percent: number;
          }[];
        },
      ) => Promise<{ success: boolean; width: number; height: number }>;
      stopNativeStream: () => Promise<{ success: boolean }>;
      createTwitchClip: () => Promise<{ clipUrl: string } | { error: string }>;
      onVodStatus: (callback: (status: VodStatus) => void) => void;
      removeOnVodStatus: () => void;
      openRecordingFolder: (filePath: string) => Promise<void>;
      openExternalUrl: (url: string) => Promise<void>;
      registerSceneHotkeys: (args: { nodeId: string; scenes: SceneHotkeyRegistration[] }) => Promise<{ registered: string[]; failed: string[] }>;
      unregisterSceneHotkeys: (args: { nodeId: string }) => Promise<void>;
      onSceneSwitch: (callback: (event: SceneSwitchEvent) => void) => void;
      removeOnSceneSwitch: () => void;
      getEncoderConfig: () => Promise<EncoderConfig | null>;
      setEncoderConfig: (config: EncoderConfig) => Promise<void>;
      // ── Stream Deck API bridge ─────────────────────────────────────────────
      sendApiStateUpdate: (patch: Record<string, unknown>) => void;
      onApiCommand: (callback: (cmd: Record<string, unknown>) => void) => void;
      removeOnApiCommand: () => void;
      triggerSceneSwitch: (args: { nodeId: string; sceneId: string; durationMs: number }) => Promise<void>;
    };
  }
}

export interface NativeCaptureSource {
  id: string;
  name: string;
  kind: "monitor" | "window" | "webcam";
}

export interface EncoderPreset {
  options: Record<string, string>;
}

export interface EncoderConfig {
  bitrate_kbps: number;
  h264_nvenc: EncoderPreset;
  libx264: EncoderPreset;
  h264_amf: EncoderPreset;
  h264_qsv: EncoderPreset;
}
