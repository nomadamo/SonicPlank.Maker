import { atomWithStorage } from "jotai/utils";
import { useAtom } from "jotai";
import { useCallback } from "react";

export type RtmpTarget = {
  id: string;
  label: string;
  preset: "twitch" | "youtube" | "tiktok" | "custom";
  url: string;
  key: string;
};

export type AppSettings = {
  autoSave: boolean;
  autoSaveIntervalMs: number; // milliseconds; e.g. 30000 = 30s
  audioOutputDeviceId?: string; // app audio playback device; empty means default
  audioInputDeviceId?: string; // microphone for recording; empty means default
  audioStreamSourceId?: string; // audio capture source for streaming (output/microphone/capture device)
  theme: "light" | "dark" | "system";
  timelineSidebarWidth?: number;
  timelineSidebarOpen?: boolean;
  playheadLatencyCompensationMs?: number;
  audioStreamIcon?: string;
  audioStreamColor?: string;
  recordingPath?: string;
  
  // FFmpeg Output Global Settings
  streamEncoder?: "copy" | "libx264" | "h264_nvenc" | "h264_amf" | "h264_qsv";
  streamFps?: 30 | 60 | 90 | 120;
  streamDelayMs?: number;
  streamBitrateKbps?: number;
  recordingBitrateKbps?: number;
  selectedGpu?: string;
  /** Output resolution: "native" | "1080p" | "936p" | "720p" */
  streamOutputResolution?: string;

  // Global RTMP Targets
  rtmpTargets: RtmpTarget[];

  // Twitch chat IRC credentials (needed since Twitch deprecated anonymous connections)
  twitchUsername?: string;
  twitchToken?: string;

  // Legacy fields to be ignored/removed later but kept for transition
  streamUrl?: string;
  streamToken?: string;
};

export const defaultSettings: AppSettings = {
  autoSave: false,
  autoSaveIntervalMs: 30000,
  audioOutputDeviceId: "",
  audioInputDeviceId: "",
  theme: "system",
  timelineSidebarWidth: 256,
  timelineSidebarOpen: true,
  playheadLatencyCompensationMs: 0,
  audioStreamIcon: "radio",
  audioStreamColor: "#a78bfa",
  recordingPath: "",
  streamUrl: "",
  streamToken: "",
  streamBitrateKbps: 6000,
  streamFps: 30,
  recordingBitrateKbps: 12000,
  streamEncoder: "copy",
  streamDelayMs: 0,
  selectedGpu: "auto",
  streamOutputResolution: "native",
  rtmpTargets: [],
};

export const settingsAtom = atomWithStorage<AppSettings>(
  "sonicplank-settings",
  defaultSettings,
);

export function useSettings() {
  const [settings, setSettings] = useAtom(settingsAtom);

  const updateSettings = useCallback((patch: Partial<AppSettings> | ((prev: AppSettings) => Partial<AppSettings>)) => {
    if (typeof patch === "function") {
      setSettings((prev) => ({ ...prev, ...patch(prev) }));
    } else {
      setSettings((prev) => ({ ...prev, ...patch }));
    }
  }, [setSettings]);

  return { settings, updateSettings };
}
