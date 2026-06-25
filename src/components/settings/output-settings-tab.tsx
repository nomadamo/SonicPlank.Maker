import * as React from "react";
import { useSettings, RtmpTarget } from "@/store/settingsStore";
import { TabsContent } from "@/components/motion/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";

const RTMP_PRESETS = [
  { id: "twitch", label: "Twitch", url: "rtmp://live.twitch.tv/app/" },
  { id: "youtube", label: "YouTube", url: "rtmp://a.rtmp.youtube.com/live2/" },
  { id: "tiktok", label: "TikTok", url: "rtmp://push-rtmp-f5-va.tiktokcdn.com/" },
  { id: "custom", label: "Custom", url: "" },
];

export function OutputSettingsTab() {
  const { settings, updateSettings } = useSettings();
  const [gpus, setGpus] = React.useState<string[]>([]);

  React.useEffect(() => {
    window.electron.getGpuList().then((list) => {
      setGpus(list || []);
      // If only one GPU and currently "auto" or empty, preselect it
      if (list && list.length === 1 && (!settings.selectedGpu || settings.selectedGpu === "auto")) {
        updateSettings({ selectedGpu: list[0] });
      }
    });
  }, [settings.selectedGpu, updateSettings]);

  const addTarget = () => {
    const newTarget: RtmpTarget = {
      id: crypto.randomUUID(),
      label: "New Target",
      preset: "twitch",
      url: RTMP_PRESETS[0].url,
      key: "",
    };
    updateSettings((prev) => ({ 
      rtmpTargets: [...(prev.rtmpTargets || []), newTarget] 
    }));
  };

  const updateTarget = (id: string, patch: Partial<RtmpTarget>) => {
    updateSettings((prev) => ({
      rtmpTargets: (prev.rtmpTargets || []).map((t) => (t.id === id ? { ...t, ...patch } : t)),
    }));
  };

  const removeTarget = (id: string) => {
    updateSettings((prev) => ({
      rtmpTargets: (prev.rtmpTargets || []).filter((t) => t.id !== id),
    }));
  };

  const setEncoderFromPreset = (preset: "record" | "stream") => {
    // Determine encoder based on selected GPU
    let encoder: typeof settings.streamEncoder = "libx264";
    const gpu = settings.selectedGpu?.toLowerCase() || "";
    if (gpu.includes("nvidia") || gpu.includes("rtx") || gpu.includes("gtx")) encoder = "h264_nvenc";
    else if (gpu.includes("amd") || gpu.includes("radeon")) encoder = "h264_amf";
    else if (gpu.includes("intel") || gpu.includes("arc")) encoder = "h264_qsv";

    updateSettings({
      streamEncoder: encoder,
      streamFps: preset === "record" ? 60 : 30,
      streamDelayMs: preset === "record" ? 0 : settings.streamDelayMs || 0,
      streamBitrateKbps: preset === "record" ? 15000 : 6000,
      recordingBitrateKbps: preset === "record" ? 15000 : 12000,
    });
  };

  return (
    <TabsContent value="output" className="flex flex-col min-h-[360px] pr-2 pb-4">
      <Accordion className="w-full space-y-4">
        {/* FFmpeg Global Settings */}
        <AccordionItem value="global" className="border-none bg-muted/20 rounded-lg overflow-hidden">
          <AccordionTrigger className="px-4 py-3 hover:bg-secondary/50 hover:no-underline data-[state=open]:border-b border-border/40">
            <h3 className="text-sm font-bold m-0">Global Encoder Settings</h3>
          </AccordionTrigger>
          <AccordionContent className="p-4 flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <Label className="text-xs">GPU Selection</Label>
              <Select
                value={settings.selectedGpu || "auto"}
                onValueChange={(v) => updateSettings({ selectedGpu: v })}
              >
                <SelectTrigger className="w-full text-xs">
                  <SelectValue placeholder="Select GPU" />
                </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto Select</SelectItem>
              {gpus.map((gpu) => (
                <SelectItem key={gpu} value={gpu}>{gpu}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => setEncoderFromPreset("record")}>
            Apply "Record" Preset
          </Button>
          <Button variant="outline" size="sm" onClick={() => setEncoderFromPreset("stream")}>
            Apply "Stream" Preset
          </Button>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <Label className="text-xs">Encoder</Label>
            <Select
              value={settings.streamEncoder || "libx264"}
              onValueChange={(v) => updateSettings({ streamEncoder: v as any })}
            >
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="libx264">libx264 (Software)</SelectItem>
                <SelectItem value="h264_nvenc">NVIDIA NVENC</SelectItem>
                <SelectItem value="h264_amf">AMD AMF</SelectItem>
                <SelectItem value="h264_qsv">Intel QSV</SelectItem>
                <SelectItem value="copy">Copy</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex flex-col gap-2">
            <Label className="text-xs">FPS</Label>
            <Select
              value={settings.streamFps?.toString() || "30"}
              onValueChange={(v) => updateSettings({ streamFps: parseInt(v) as 30 | 60 | 90 | 120 })}
            >
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30 FPS</SelectItem>
                <SelectItem value="60">60 FPS</SelectItem>
                <SelectItem value="90">90 FPS</SelectItem>
                <SelectItem value="120">120 FPS</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-xs">Output Resolution</Label>
            <Select
              value={settings.streamOutputResolution || "native"}
              onValueChange={(v) => updateSettings({ streamOutputResolution: v })}
            >
              <SelectTrigger className="text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="native">Native (Source)</SelectItem>
                <SelectItem value="1080p">1080p (1920×1080)</SelectItem>
                <SelectItem value="936p">936p (1664×936) — Twitch Sweet Spot</SelectItem>
                <SelectItem value="720p">720p (1280×720)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-xs">Stream Bitrate (Kbps)</Label>
            <Input 
              type="number" 
              value={settings.streamBitrateKbps || 6000} 
              onChange={(e) => updateSettings({ streamBitrateKbps: parseInt(e.target.value) || 6000 })}
              className="text-xs font-mono"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label className="text-xs">Stream Delay (ms)</Label>
            <Input 
              type="number" 
              value={settings.streamDelayMs || 0} 
              onChange={(e) => updateSettings({ streamDelayMs: parseInt(e.target.value) || 0 })}
              className="text-xs font-mono"
            />
          </div>
          </div>
        </AccordionContent>
      </AccordionItem>

      {/* Recording Path */}
      <AccordionItem value="recording" className="border-none bg-muted/20 rounded-lg overflow-hidden">
        <AccordionTrigger className="px-4 py-3 hover:bg-secondary/50 hover:no-underline data-[state=open]:border-b border-border/40">
          <h3 className="text-sm font-bold m-0">Recording Settings</h3>
        </AccordionTrigger>
        <AccordionContent className="p-4 flex flex-col gap-3">
          <div className="flex flex-col gap-1 text-left">
          <Label className="text-xs">Recording Save Directory</Label>
        </div>
        <div className="flex items-center gap-2">
          <Input
            readOnly
            placeholder="System Default"
            value={settings.recordingPath || "Default (Documents/SonicPlank.Maker/recordings)"}
            className="flex-1 text-xs select-all bg-muted/30"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                const paths = await window.electron.openFileDialog({
                  properties: ["openDirectory"],
                  filters: [],
                });
                if (paths && paths.length > 0) {
                  updateSettings({ recordingPath: paths[0] });
                }
              } catch (err) {
                console.error("Failed to pick recording path directory:", err);
              }
            }}
          >
            Browse...
          </Button>
          {settings.recordingPath && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => updateSettings({ recordingPath: "" })}
            >
              Reset
            </Button>
          )}
        </div>
        <div className="flex flex-col gap-1.5 text-left mt-1">
          <Label className="text-xs">Recording Video Bitrate (Kbps)</Label>
          <Input
            type="number"
            placeholder="e.g. 12000"
            value={settings.recordingBitrateKbps ?? 12000}
            onChange={(e) => {
              const val = parseInt(e.target.value, 10);
              updateSettings({ recordingBitrateKbps: isNaN(val) ? undefined : val });
            }}
            className="text-xs font-mono w-40"
          />
        </div>
        </AccordionContent>
      </AccordionItem>

      {/* Stream Services */}
      <AccordionItem value="stream" className="border-none bg-muted/20 rounded-lg overflow-hidden">
        <AccordionTrigger className="px-4 py-3 hover:bg-secondary/50 hover:no-underline data-[state=open]:border-b border-border/40">
          <h3 className="text-sm font-bold m-0">Stream Services</h3>
        </AccordionTrigger>
        <AccordionContent className="p-4 flex flex-col gap-4">
          <div className="flex items-center justify-end">
            <Button variant="ghost" size="sm" onClick={addTarget} className="h-6 px-2 text-xs">
              <Plus className="w-3 h-3 mr-1" /> Add Service
            </Button>
          </div>

          <div className="flex flex-col gap-4">
          {(settings.rtmpTargets || []).length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No stream services configured.</p>
          ) : (
            settings.rtmpTargets.map((target) => (
              <div key={target.id} className="flex flex-col gap-3 p-3 bg-muted/50 border border-border rounded-lg">
                  <div className="flex items-center justify-between gap-4">
                    <Input 
                      value={target.label} 
                      onChange={(e) => updateTarget(target.id, { label: e.target.value })}
                      className="text-sm font-bold h-8"
                      placeholder="Service Name"
                    />
                    <Button variant="ghost" size="sm" onClick={() => removeTarget(target.id)} className="h-8 w-8 p-0 text-red-500 hover:text-red-400 hover:bg-red-500/10 shrink-0">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                  <Label className="text-xs text-right">Service</Label>
                  <Select
                    value={target.preset}
                    onValueChange={(v: any) => {
                      const presetUrl = RTMP_PRESETS.find(p => p.id === v)?.url || "";
                      updateTarget(target.id, { preset: v, url: presetUrl });
                    }}
                  >
                    <SelectTrigger className="h-7 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RTMP_PRESETS.map(p => (
                        <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                  <Label className="text-xs text-right">Server URL</Label>
                  <Input 
                    value={target.url} 
                    onChange={(e) => updateTarget(target.id, { url: e.target.value })}
                    className="h-7 text-xs font-mono"
                    readOnly={target.preset !== "custom"}
                  />
                </div>

                <div className="grid grid-cols-[100px_1fr] items-center gap-2">
                  <Label className="text-xs text-right">Stream Key</Label>
                  <Input 
                    type="password"
                    value={target.key} 
                    onChange={(e) => updateTarget(target.id, { key: e.target.value })}
                    className="h-7 text-xs font-mono"
                    placeholder="live_xxxxxxxxx"
                  />
                </div>
              </div>
            ))
          )}
        </div>
        </AccordionContent>
      </AccordionItem>
      </Accordion>
    </TabsContent>
  );
}
