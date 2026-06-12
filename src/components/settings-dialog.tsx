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
import { Moon, Sun, Monitor, Speaker } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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
  const [outputDevices, setOutputDevices] = React.useState<MediaDeviceInfo[]>(
    [],
  );
  const [inputDevices, setInputDevices] = React.useState<MediaDeviceInfo[]>([]);
  const { theme, setTheme } = useStateMachine();

  React.useEffect(() => {
    if (open) {
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then(() => navigator.mediaDevices.enumerateDevices())
        .catch(() => navigator.mediaDevices.enumerateDevices())
        .then((devices) => {
          setOutputDevices(devices.filter((d) => d.kind === "audiooutput"));
          setInputDevices(devices.filter((d) => d.kind === "audioinput"));
        });
    }
  }, [open]);

  const selectedOutputDevice = outputDevices.find(
    (d) => d.deviceId === settings.audioOutputDeviceId,
  );
  const outputDisplayLabel = settings.audioOutputDeviceId
    ? selectedOutputDevice?.label ||
      `Speaker (${settings.audioOutputDeviceId.slice(0, 5)}...)`
    : "System Default";

  const selectedInputDevice = inputDevices.find(
    (d) => d.deviceId === settings.audioInputDeviceId,
  );
  const inputDisplayLabel = settings.audioInputDeviceId
    ? selectedInputDevice?.label ||
      `Microphone (${settings.audioInputDeviceId.slice(0, 5)}...)`
    : "System Default";

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
      <DialogContent style={{ maxWidth: "500px" }}>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Configure your application preferences.
          </DialogDescription>
        </DialogHeader>
        <Separator />

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
              <span className="text-xs text-muted-foreground">
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
              <label className="text-xs text-muted-foreground">Interval</label>
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

        {/* Audio Output Device */}
        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium">Audio Output</label>
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
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label ||
                    `Speaker (${device.deviceId.slice(0, 5)}...)`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Separator />

        {/* Audio Input Device */}
        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium">Audio Input</label>
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
              <SelectValue placeholder="Select input device">
                {inputDisplayLabel}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">System Default</SelectItem>
              {inputDevices.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label ||
                    `Microphone (${device.deviceId.slice(0, 5)}...)`}
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
              <label className="text-sm font-medium">
                Playhead Latency Compensation
              </label>
              <span className="text-xs text-muted-foreground">
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

        <Separator />

        {/* Stream Customization */}
        <div className="flex flex-col gap-3">
          <label className="text-sm font-medium">Stream Appearance</label>
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
            <span className="text-xs text-muted-foreground">
              Customize the badge icon and color for stream cards
            </span>
          </div>
        </div>

        <DialogFooter showCloseButton />
      </DialogContent>
    </Dialog>
  );
}
