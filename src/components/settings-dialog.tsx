import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useSettings } from "@/store/settingsStore";
import { Button } from "@/components/ui/button";
import { Moon, Sun, Monitor } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/motion/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { EncoderConfig } from "@/global";
import {
  NVENC_OPTS, X264_OPTS, AMF_OPTS, QSV_OPTS,
  ENCODER_LABELS, makeDefaultEncoderConfig, type EncoderKey,
} from "@/constants/encoder";
import { useStateMachine } from "@/store/stateMachine";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Icon, IconName, IconPicker } from "@/components/ui/icon-picker";
import {
  ColorArea,
  ColorField,
  ColorPicker,
  ColorSlider,
  ColorSwatch,
  ColorThumb,
  SliderTrack,
} from "@/components/ui/color";
import { OutputSettingsTab } from "./settings/output-settings-tab";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// ── Helper sub-components ─────────────────────────────────────────────────────

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-center gap-2">
      <span className="text-xs text-muted-foreground text-right">{label}</span>
      {children}
    </div>
  );
}

function OptionSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
}) {
  return (
    <Select value={value || "__none__"} onValueChange={(v: string) => onChange(v === "__none__" ? "" : v)}>
      <SelectTrigger className="h-7 text-xs font-mono">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__" className="text-xs font-mono text-muted-foreground">— default —</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o} className="text-xs font-mono">{o}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function NumField({
  value,
  placeholder,
  step = 1,
  onChange,
}: {
  value: number | null;
  placeholder: string;
  step?: number;
  onChange: (v: number | null) => void;
}) {
  return (
    <Input
      type="number"
      step={step}
      className="h-7 text-xs font-mono"
      placeholder={placeholder}
      value={value ?? ""}
      onChange={(e) => {
        const n = step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
        onChange(isNaN(n) ? null : n);
      }}
    />
  );
}

// ── Core encoder settings tab ─────────────────────────────────────────────────

// EncoderKey imported from @/constants/encoder

const ENCODER_OPT_MAP = {
  h264_nvenc: NVENC_OPTS,
  libx264:    X264_OPTS,
  h264_amf:   AMF_OPTS,
  h264_qsv:   QSV_OPTS,
} as const;

function CoreTab() {
  const [config, setConfigState] = React.useState<EncoderConfig | null>(null);
  const [activeEncoder, setActiveEncoder] = React.useState<EncoderKey>("h264_nvenc");
  const [isDirty, setIsDirty] = React.useState(false);
  const [applyState, setApplyState] = React.useState<"idle" | "saved">("idle");

  React.useEffect(() => {
    window.electron.getEncoderConfig().then((cfg) => {
      setConfigState(cfg ?? makeDefaultEncoderConfig());
    }).catch(console.error);
  }, []);

  const setOption = React.useCallback((encoder: EncoderKey, key: string, val: string) => {
    setConfigState((prev) => {
      if (!prev) return prev;
      const opts = { ...prev[encoder].options };
      if (val) opts[key] = val; else delete opts[key];
      return { ...prev, [encoder]: { ...prev[encoder], options: opts } };
    });
    setIsDirty(true);
    setApplyState("idle");
  }, []);

  const setBitrate = React.useCallback((val: number | null) => {
    setConfigState((prev) => {
      if (!prev) return prev;
      return { ...prev, bitrate_kbps: val ?? 6000 };
    });
    setIsDirty(true);
    setApplyState("idle");
  }, []);

  const handleApply = React.useCallback(() => {
    if (!config) return;
    window.electron.setEncoderConfig(config)
      .then(() => {
        setIsDirty(false);
        setApplyState("saved");
        setTimeout(() => setApplyState("idle"), 2000);
      })
      .catch(console.error);
  }, [config]);

  if (!config) {
    return (
      <TabsContent value="core" className="flex items-center justify-center min-h-[360px]">
        <span className="text-xs text-muted-foreground">Loading…</span>
      </TabsContent>
    );
  }

  const preset = config[activeEncoder];
  const opt = (key: string) => preset.options[key] ?? "";
  const opts = ENCODER_OPT_MAP[activeEncoder] as Record<string, { label: string; values: readonly string[] }>;

  return (
    <TabsContent value="core" className="flex flex-col gap-3 min-h-[360px]">
      <div className="flex flex-col gap-1 text-left">
        <label className="text-sm font-medium">Encoder Presets</label>
        <span className="text-xs text-muted-foreground">
          Applied at next stream start. Click Apply to save.
        </span>
      </div>

      <FieldRow label="Stream Bitrate (kbps)">
        <NumField value={config.bitrate_kbps} placeholder="8000" onChange={setBitrate} />
      </FieldRow>

      <div className="flex gap-1.5">
        {(Object.keys(ENCODER_LABELS) as EncoderKey[]).map((enc) => (
          <Button
            key={enc}
            size="sm"
            variant={activeEncoder === enc ? "default" : "outline"}
            className="text-xs flex-1 px-1"
            onClick={() => setActiveEncoder(enc)}
          >
            {ENCODER_LABELS[enc]}
          </Button>
        ))}
      </div>

      <Separator />

      <div className="flex flex-col gap-2.5">
        {Object.entries(opts).map(([key, def]) => (
          <FieldRow key={key} label={def.label}>
            <OptionSelect
              value={opt(key)}
              options={def.values}
              onChange={(v) => setOption(activeEncoder, key, v)}
            />
          </FieldRow>
        ))}

      </div>

      <div className="flex items-center gap-3 justify-end mt-auto pt-1">
        {applyState === "saved" && (
          <span className="text-xs text-green-500">Saved</span>
        )}
        {isDirty && applyState !== "saved" && (
          <span className="text-xs text-muted-foreground">Unsaved changes</span>
        )}
        <Button size="sm" disabled={!isDirty} onClick={handleApply}>
          Apply
        </Button>
      </div>
    </TabsContent>
  );
}

const INTERVAL_OPTIONS: { label: string; value: number }[] = [
  { label: "15s", value: 15_000 },
  { label: "30s", value: 30_000 },
  { label: "1m", value: 60_000 },
  { label: "2m", value: 120_000 },
  { label: "5m", value: 300_000 },
];

export function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { settings, updateSettings } = useSettings();
  type AudioDevice = { id: string; name: string; kind: "output" | "microphone" | "capture"; is_default: boolean };
  const [outputDevices,  setOutputDevices]  = React.useState<AudioDevice[]>([]);
  const [micDevices,     setMicDevices]     = React.useState<AudioDevice[]>([]);
  const [captureDevices, setCaptureDevices] = React.useState<AudioDevice[]>([]);
  const { theme, setTheme } = useStateMachine();

  React.useEffect(() => {
    if (open) {
      window.electron.getAudioDevices().then((devices) => {
        setOutputDevices(devices.filter((d) => d.kind === "output"));
        setMicDevices(devices.filter((d) => d.kind === "microphone"));
        setCaptureDevices(devices.filter((d) => d.kind === "capture"));
      });
    }
  }, [open]);

  const allDevices = [...outputDevices, ...micDevices, ...captureDevices];

  const selectedOutputDevice = outputDevices.find(
    (d) => d.id === settings.audioOutputDeviceId,
  );
  const outputDisplayLabel = settings.audioOutputDeviceId
    ? selectedOutputDevice?.name ||
      `Speaker (${settings.audioOutputDeviceId.slice(0, 5)}...)`
    : "System Default";

  const selectedMicDevice = micDevices.find(
    (d) => d.id === settings.audioInputDeviceId,
  );
  const inputDisplayLabel = settings.audioInputDeviceId
    ? selectedMicDevice?.name ||
      `Microphone (${settings.audioInputDeviceId.slice(0, 5)}...)`
    : "System Default";

  const selectedStreamSource = allDevices.find(
    (d) => d.id === settings.audioStreamSourceId,
  );
  const streamSourceLabel = settings.audioStreamSourceId
    ? selectedStreamSource?.name ||
      `Device (${settings.audioStreamSourceId.slice(0, 8)}...)`
    : "None";

  const themeOptions: {
    value: "light" | "dark" | "system";
    label: string;
    icon: React.ReactNode;
  }[] = [
    { value: "light", label: "Light", icon: <Sun className="h-4 w-4" /> },
    { value: "dark", label: "Dark", icon: <Moon className="h-4 w-4" /> },
    {
      value: "system",
      label: "System",
      icon: <Monitor className="h-4 w-4" />,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: "500px", minHeight: "560px", maxHeight: "90vh" }} className="flex flex-col justify-start overflow-y-auto overflow-x-hidden">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your application preferences.
          </DialogDescription>
        </DialogHeader>
        <Separator />

        <Tabs defaultValue="general" variant="segment" className="w-full">
          <TabsList className="w-full grid grid-cols-4 mb-4">
            <TabsTrigger value="general" className="w-full">General</TabsTrigger>
            <TabsTrigger value="audio" className="w-full">Audio</TabsTrigger>
            <TabsTrigger value="output" className="w-full">Output</TabsTrigger>
            <TabsTrigger value="core" className="w-full">Core</TabsTrigger>
          </TabsList>

          {/* General Tab */}
          <TabsContent value="general" className="flex flex-col gap-4 min-h-[360px]">
            {/* Theme Selection */}
            <div className="flex flex-col gap-3">
              <label className="text-sm font-medium">Theme</label>
              <div className="flex gap-2">
                {themeOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant={theme === option.value ? "default" : "outline"}
                    size="sm"
                    className="flex-1 gap-2"
                    onClick={() => setTheme(option.value)}
                  >
                    {option.icon}
                    {option.label}
                  </Button>
                ))}
              </div>
            </div>

            <Separator />

            {/* Auto-save */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <label className="text-sm font-medium">Auto-save</label>
                  <span className="text-xs text-muted-foreground text-left">
                    Automatically save the flow to disk on a timer
                  </span>
                </div>
                {/* Toggle button */}
                <button
                  role="switch"
                  aria-checked={settings.autoSave}
                  onClick={() => updateSettings({ autoSave: !settings.autoSave })}
                  className="relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{
                    backgroundColor: settings.autoSave
                      ? "var(--accent-9)"
                      : "hsl(var(--muted))",
                  }}
                >
                  <span
                    className="pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-lg ring-0 transition-transform duration-200"
                    style={{
                      transform: settings.autoSave
                        ? "translateX(20px)"
                        : "translateX(0px)",
                    }}
                  />
                </button>
              </div>

              {/* Interval selector — only shown when auto-save is on */}
              {settings.autoSave && (
                <div className="flex flex-col gap-2">
                  <label className="text-xs text-muted-foreground text-left">Interval</label>
                  <div className="flex gap-2">
                    {INTERVAL_OPTIONS.map((opt) => (
                      <Button
                        key={opt.value}
                        variant={
                          settings.autoSaveIntervalMs === opt.value
                            ? "default"
                            : "outline"
                        }
                        size="sm"
                        className="flex-1"
                        onClick={() =>
                          updateSettings({ autoSaveIntervalMs: opt.value })
                        }
                      >
                        {opt.label}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <Separator />

            {/* Stream Customization */}
            <div className="flex flex-col gap-3">
              <label className="text-sm font-medium text-left">Stream Appearance</label>
              <div className="flex items-center gap-3">
                <ColorPicker
                  value={settings.audioStreamColor || "#a78bfa"}
                  onChange={(col) =>
                    updateSettings({ audioStreamColor: col.toString("hex") })
                  }
                >
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button
                          variant="ghost"
                          className="flex h-fit items-center gap-2 p-1"
                        >
                          <ColorSwatch className="size-8 rounded-md border-2" />
                        </Button>
                      }
                    />
                    <PopoverContent className="w-fit">
                      <div>
                        <ColorArea
                          colorSpace="hsb"
                          xChannel="saturation"
                          yChannel="brightness"
                          className="h-[162px] rounded-b-none border-b-0"
                        >
                          <ColorThumb className="z-50" />
                        </ColorArea>
                        <ColorSlider colorSpace="hsb" channel="hue">
                          <SliderTrack className="rounded-t-none border-t-0">
                            <ColorThumb className="top-1/2" />
                          </SliderTrack>
                        </ColorSlider>
                      </div>
                      <div className="flex flex-row gap-2 mt-2">
                        <ColorField colorSpace="rgb" className="w-[140px]">
                          <Input
                            id="stream-settings-color"
                            aria-label="Hex"
                            value={settings.audioStreamColor || "#a78bfa"}
                          />
                        </ColorField>
                      </div>
                    </PopoverContent>
                  </Popover>
                </ColorPicker>

                <Tooltip>
                  <TooltipTrigger
                    render={
                      <IconPicker
                        categorized={false}
                        value={(settings.audioStreamIcon as IconName) || "radio"}
                        onValueChange={(icon) =>
                          updateSettings({ audioStreamIcon: icon })
                        }
                        render={
                          <Button variant="outline">
                            <Icon
                              name={
                                (settings.audioStreamIcon as IconName) || "radio"
                              }
                            />
                          </Button>
                        }
                      />
                    }
                  />
                  <TooltipContent>Choose icon for Streams</TooltipContent>
                </Tooltip>
                <span className="text-xs text-muted-foreground text-left">
                  Customize the badge icon and color for stream cards
                </span>
              </div>
            </div>

            <Separator />

            {/* Twitch Chat */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <label className="text-sm font-medium text-left">Twitch Chat</label>
                <span className="text-xs text-muted-foreground text-left">
                  Requires a user access token with the{" "}
                  <code className="text-indigo-400 text-[11px]">user:read:chat</code> scope.
                  Generate one at{" "}
                  <a
                    href="https://twitchtokengenerator.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-400 hover:underline"
                    onClick={(e) => { e.preventDefault(); window.open("https://twitchtokengenerator.com/"); }}
                  >
                    twitchtokengenerator.com
                  </a>
                  {" "}— select <em>Custom Scope Token</em> and check <code className="text-indigo-400 text-[11px]">user:read:chat</code>.
                </span>
              </div>
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-muted-foreground">OAuth Token</label>
                  <input
                    type="password"
                    placeholder="oauth:xxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={settings.twitchToken || ""}
                    onChange={(e) => updateSettings({ twitchToken: e.target.value.trim() })}
                    className="w-full bg-muted border border-border rounded px-2.5 py-1.5 text-sm text-foreground focus:border-indigo-500 focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Audio Tab */}
          <TabsContent value="audio" className="flex flex-col gap-4 min-h-[360px]">
            {/* Stream Audio Source */}
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-0.5">
                <label className="text-sm font-medium text-left">Stream Audio Source</label>
                <span className="text-xs text-muted-foreground text-left">
                  Audio captured and mixed into the stream. Select an Audio Capture Device
                  (e.g. VoiceMeeter Output) for software routing, a Microphone for direct
                  mic capture, or a System Audio device for WASAPI loopback.
                </span>
              </div>
              <Select
                value={settings.audioStreamSourceId || "none"}
                onValueChange={(val) => {
                  if (typeof val === "string") {
                    updateSettings({ audioStreamSourceId: val === "none" ? "" : val });
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select stream audio source">
                    {streamSourceLabel}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {captureDevices.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                        Audio Capture Devices
                      </div>
                      {captureDevices.map((device) => (
                        <SelectItem key={device.id} value={device.id}>
                          {device.name}
                        </SelectItem>
                      ))}
                    </>
                  )}
                  {micDevices.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                        Microphones
                      </div>
                      {micDevices.map((device) => (
                        <SelectItem key={device.id} value={device.id}>
                          {device.name}
                        </SelectItem>
                      ))}
                    </>
                  )}
                  {outputDevices.length > 0 && (
                    <>
                      <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                        System Audio (Loopback)
                      </div>
                      {outputDevices.map((device) => (
                        <SelectItem key={device.id} value={device.id}>
                          {device.name}
                        </SelectItem>
                      ))}
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Audio Output Device */}
            <div className="flex flex-col gap-3">
              <label className="text-sm font-medium text-left">Audio Output</label>
              <Select
                value={settings.audioOutputDeviceId || "default"}
                onValueChange={(val) => {
                  if (typeof val === "string") {
                    updateSettings({
                      audioOutputDeviceId: val === "default" ? "" : val,
                    });
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select output device">
                    {outputDisplayLabel}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">System Default</SelectItem>
                  {outputDevices.map((device) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.name ||
                        `Speaker (${device.id.slice(0, 5)}...)`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Microphone */}
            <div className="flex flex-col gap-3">
              <label className="text-sm font-medium text-left">Microphone</label>
              <Select
                value={settings.audioInputDeviceId || "default"}
                onValueChange={(val) => {
                  if (typeof val === "string") {
                    updateSettings({
                      audioInputDeviceId: val === "default" ? "" : val,
                    });
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select microphone">
                    {inputDisplayLabel}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="default">System Default</SelectItem>
                  {micDevices.map((device) => (
                    <SelectItem key={device.id} value={device.id}>
                      {device.name ||
                        `Microphone (${device.id.slice(0, 5)}...)`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            {/* Playhead Latency Compensation */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <div className="flex flex-col gap-0.5">
                  <label className="text-sm font-medium text-left">
                    Playhead Latency Compensation
                  </label>
                  <span className="text-xs text-muted-foreground text-left">
                    Offsets the visual playhead during playback to match
                    sound output (supports negative values)
                  </span>
                </div>
                <span className="text-xs font-mono text-muted-foreground bg-muted px-2.5 py-1 rounded-md border border-border">
                  {settings.playheadLatencyCompensationMs ?? 0} ms
                </span>
              </div>
              <Slider
                value={[settings.playheadLatencyCompensationMs ?? 0]}
                min={-1000}
                max={1000}
                step={10}
                onValueChange={(val) => {
                  const value = Array.isArray(val) ? val[0] : val;
                  if (Number.isFinite(value)) {
                    updateSettings({ playheadLatencyCompensationMs: value });
                  }
                }}
              />
            </div>
          </TabsContent>

          {/* Core Tab */}
          <CoreTab />

          {/* Output / Recording Tab */}
          <OutputSettingsTab />
        </Tabs>

        <Separator />

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
