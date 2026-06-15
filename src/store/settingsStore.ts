import { atomWithStorage } from "jotai/utils";
import { useAtom } from "jotai";

export type AppSettings = {
  autoSave: boolean;
  autoSaveIntervalMs: number; // milliseconds; e.g. 30000 = 30s
  audioOutputDeviceId?: string; // empty means default
  audioInputDeviceId?: string; // empty means default
  theme: "light" | "dark" | "system";
  timelineSidebarWidth?: number;
  timelineSidebarOpen?: boolean;
  playheadLatencyCompensationMs?: number;
  audioStreamIcon?: string;
  audioStreamColor?: string;
  recordingPath?: string;
  streamUrl?: string;
  streamToken?: string;
  streamBitrateKbps?: number;
  recordingBitrateKbps?: number;
  streamEncoder?: "copy" | "libx264" | "h264_nvenc" | "h264_amf" | "h264_qsv";
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
  recordingBitrateKbps: 12000,
  streamEncoder: "copy",
};

export const settingsAtom = atomWithStorage<AppSettings>(
  "sonicplank-settings",
  defaultSettings,
);

export function useSettings() {
  const [settings, setSettings] = useAtom(settingsAtom);

  const updateSettings = (patch: Partial<AppSettings>) => {
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  return { settings, updateSettings };
}
