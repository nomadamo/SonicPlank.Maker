import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { CustomColorPicker } from "@/components/ui/custom-color-picker";
import { FlowNodeType, NodeTrigger } from "@/types/flow-node";
import { useSetAtom } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import {
  FileAudioIcon,
  UserIcon,
  MusicIcon,
  Volume2Icon,
  Settings as SettingsIcon,
  Type as TypeIcon,
  Palette as PaletteIcon,
  Image as ImageIcon,
  Activity as ActivityIcon,
  Tv as MonitorIcon,
  SlidersHorizontal as ControlsIcon,
} from "lucide-react";
import { NODE_ACTIONS } from "@/utils/node-actions";
import { cn } from "@/lib/utils";

interface NodePropertiesDialogProps {
  node: FlowNodeType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDuration(seconds: number | undefined | null): string {
  if (!seconds) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function NodePropertiesDialog({
  node,
  open,
  onOpenChange,
}: NodePropertiesDialogProps) {
  const updateNodeData = useSetAtom(updateNodeDataAtom);

  // Form States
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [volume, setVolume] = useState(1);
  const [textContent, setTextContent] = useState("");
  const [fontSize, setFontSize] = useState(4);
  const [textColor, setTextColor] = useState("#ffffff");
  const [backgroundColor, setBackgroundColor] = useState("rgba(0, 0, 0, 0.3)");
  const [fontFamily, setFontFamily] = useState("Inter, sans-serif");
  const [fontWeight, setFontWeight] = useState("normal");
  const [fontStyle, setFontStyle] = useState("normal");
  const [imagePath, setImagePath] = useState("");
  const [visualizerType, setVisualizerType] = useState("bars");
  const [captureAudio, setCaptureAudio] = useState(false);
  const [triggers, setTriggers] = useState<NodeTrigger[]>([]);
  const [recordingTriggerId, setRecordingTriggerId] = useState<string | null>(null);

  // Sync state when dialog target changes
  useEffect(() => {
    if (!node) return;
    const data = node.data as any;
    setTitle(data.title ?? "");
    setArtist(data.artist ?? "");
    setVolume(data.volume ?? 1);
    setTextContent(data.textContent ?? "");
    setFontSize(data.fontSize ?? 4);
    setTextColor(data.textColor ?? "#ffffff");
    setBackgroundColor(data.backgroundColor ?? "rgba(0, 0, 0, 0.3)");
    setFontFamily(data.fontFamily ?? "Inter, sans-serif");
    setFontWeight(data.fontWeight ?? "normal");
    setFontStyle(data.fontStyle ?? "normal");
    setImagePath(data.imagePath ?? "");
    setVisualizerType(data.visualizerType ?? "bars");
    setCaptureAudio(!!data.captureAudio);
    setTriggers(data.triggers ?? []);
    setRecordingTriggerId(null);
  }, [node]);

  // Keypress listener for hotkey recording
  useEffect(() => {
    if (!recordingTriggerId) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const key = e.code || e.key;
      const isModifier = [
        "Control", "ControlLeft", "ControlRight",
        "Shift", "ShiftLeft", "ShiftRight",
        "Alt", "AltLeft", "AltRight",
        "Meta", "MetaLeft", "MetaRight", "OSLeft", "OSRight"
      ].includes(key);

      const modifiers: string[] = [];
      if (e.ctrlKey) modifiers.push("Ctrl");
      if (e.altKey) modifiers.push("Alt");
      if (e.shiftKey) modifiers.push("Shift");
      if (e.metaKey) modifiers.push("Meta");

      let hotkeyStr = "";
      if (isModifier) {
        hotkeyStr = modifiers.join("+");
        setTriggers((prev) =>
          prev.map((t) =>
            t.id === recordingTriggerId
              ? { ...t, triggerKey: hotkeyStr ? `${hotkeyStr}+...` : "Press key..." }
              : t
          )
        );
      } else {
        hotkeyStr = modifiers.length > 0 ? `${modifiers.join("+")}+${key}` : key;
        setTriggers((prev) =>
          prev.map((t) => (t.id === recordingTriggerId ? { ...t, triggerKey: hotkeyStr } : t))
        );
        setRecordingTriggerId(null);
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [recordingTriggerId]);

  const handleSave = useCallback(() => {
    if (!node) return;
    const patch: any = { triggers };

    if (node.type === "audioFlowNode") {
      patch.title = title;
      patch.artist = artist;
      patch.volume = volume;
    } else if (node.type === "textOverlayNode") {
      patch.textContent = textContent;
      patch.fontSize = fontSize;
      patch.textColor = textColor;
      patch.fontFamily = fontFamily;
      patch.fontWeight = fontWeight;
      patch.fontStyle = fontStyle;
    } else if (node.type === "colorOverlayNode") {
      patch.backgroundColor = backgroundColor;
    } else if (node.type === "imageOverlayNode") {
      patch.imagePath = imagePath;
    } else if (node.type === "visualizerOverlayNode") {
      patch.visualizerType = visualizerType;
    } else if (node.type === "captureSourceNode") {
      patch.captureAudio = captureAudio;
    }

    updateNodeData({ id: node.id, patch });
    onOpenChange(false);
  }, [
    node,
    title,
    artist,
    volume,
    textContent,
    fontSize,
    textColor,
    fontFamily,
    fontWeight,
    fontStyle,
    backgroundColor,
    imagePath,
    visualizerType,
    captureAudio,
    triggers,
    updateNodeData,
    onOpenChange,
  ]);

  if (!node) return null;

  const nodeType = node.type || "";
  const availableActions = NODE_ACTIONS[nodeType];

  // Pick Icon based on node type
  let DialogIcon = SettingsIcon;
  let description = "Edit settings and hotkey triggers for this node.";
  let titleLabel = "Node Properties";

  if (nodeType === "audioFlowNode") {
    DialogIcon = MusicIcon;
    titleLabel = "Audio Source Properties";
    description = "Edit the track details, volumes, and triggers.";
  } else if (nodeType === "textOverlayNode") {
    DialogIcon = TypeIcon;
    titleLabel = "Text Overlay Properties";
  } else if (nodeType === "colorOverlayNode") {
    DialogIcon = PaletteIcon;
    titleLabel = "Color Block Properties";
  } else if (nodeType === "imageOverlayNode") {
    DialogIcon = ImageIcon;
    titleLabel = "Image Overlay Properties";
  } else if (nodeType === "visualizerOverlayNode") {
    DialogIcon = ActivityIcon;
    titleLabel = "Visualizer Overlay Properties";
  } else if (nodeType === "captureSourceNode") {
    DialogIcon = MonitorIcon;
    titleLabel = "Capture Source Properties";
  } else if (nodeType === "targetOutputNode") {
    DialogIcon = ControlsIcon;
    titleLabel = "Compositor Output Properties";
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: "480px" }} className="bg-background text-white border-border">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-foreground">
            <DialogIcon className="h-5 w-5 text-indigo-400" />
            {titleLabel}
          </DialogTitle>
          <DialogDescription className="text-muted-foreground">
            {description}
          </DialogDescription>
        </DialogHeader>

        <Separator className="bg-secondary/60" />

        <div className="flex flex-col gap-4 py-2">
          {/* Audio Node Specific Fields */}
          {nodeType === "audioFlowNode" && (
            <>
              {/* Title */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prop-title" className="flex items-center gap-1.5 text-foreground/80">
                  <MusicIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  Title
                </Label>
                <Input
                  id="prop-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Track title"
                  className="bg-muted border-border text-foreground focus:border-indigo-500"
                />
              </div>

              {/* Artist */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="prop-artist" className="flex items-center gap-1.5 text-foreground/80">
                  <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  Artist
                </Label>
                <Input
                  id="prop-artist"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="Artist name"
                  className="bg-muted border-border text-foreground focus:border-indigo-500"
                />
              </div>

              {/* Volume */}
              <div className="flex flex-col gap-1.5">
                <Label className="flex items-center gap-1.5 text-foreground/80">
                  <Volume2Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  Default Volume — {Math.round(volume * 100)}%
                </Label>
                <Slider
                  id="prop-volume"
                  min={0}
                  max={1}
                  step={0.01}
                  value={volume}
                  onValueChange={(v) => setVolume(v as number)}
                  className="accent-indigo-500"
                />
              </div>

              <Separator className="bg-secondary/60" />

              {/* Read-only metadata */}
              <div className="flex flex-col gap-2 bg-muted/40 p-2.5 rounded-lg border border-border/50">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  File Info
                </p>
                <div className="flex items-start gap-2">
                  <FileAudioIcon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                  <p className="text-xs text-muted-foreground break-all" title={node.data.mediaPath}>
                    {node.data.mediaPath || "—"}
                  </p>
                </div>
                {node.data.duration != null && (
                  <p className="text-xs text-muted-foreground">
                    Duration: {formatDuration(node.data.duration)}
                  </p>
                )}
              </div>
            </>
          )}

          {/* Text Overlay Specific Fields */}
          {nodeType === "textOverlayNode" && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label className="text-foreground/80">Watermark Text</Label>
                <Input
                  value={textContent}
                  onChange={(e) => setTextContent(e.target.value)}
                  placeholder="e.g. Live Stream"
                  className="bg-muted border-border text-foreground"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-foreground/80">Font Size ({fontSize}%)</Label>
                <Slider
                  min={1}
                  max={20}
                  step={0.5}
                  value={fontSize}
                  onValueChange={(v) => setFontSize(v as number)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-foreground/80">Text Color</Label>
                <div className="flex gap-2 items-center">
                  <CustomColorPicker
                    value={textColor}
                    onChange={setTextColor}
                  />
                  <Input
                    value={textColor}
                    onChange={(e) => setTextColor(e.target.value)}
                    className="flex-1 bg-muted border-border text-foreground"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label className="text-foreground/80">Font Family</Label>
                <select
                  value={fontFamily}
                  onChange={(e) => setFontFamily(e.target.value)}
                  className="w-full bg-muted border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none cursor-pointer"
                >
                  <option value="Inter, sans-serif">Inter</option>
                  <option value="Roboto, sans-serif">Roboto</option>
                  <option value="Outfit, sans-serif">Outfit</option>
                  <option value='"Playfair Display", serif'>Playfair Display</option>
                  <option value='"Fira Code", monospace'>Fira Code</option>
                  <option value="Georgia, serif">Georgia</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label className="text-foreground/80">Font Weight</Label>
                  <select
                    value={fontWeight}
                    onChange={(e) => setFontWeight(e.target.value)}
                    className="w-full bg-muted border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none cursor-pointer"
                  >
                    <option value="300">Light</option>
                    <option value="normal">Regular</option>
                    <option value="500">Medium</option>
                    <option value="600">Semi-Bold</option>
                    <option value="bold">Bold</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label className="text-foreground/80">Font Style</Label>
                  <select
                    value={fontStyle}
                    onChange={(e) => setFontStyle(e.target.value)}
                    className="w-full bg-muted border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none cursor-pointer"
                  >
                    <option value="normal">Normal</option>
                    <option value="italic">Italic</option>
                  </select>
                </div>
              </div>
            </>
          )}

          {/* Color Overlay Specific Fields */}
          {nodeType === "colorOverlayNode" && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-foreground/80">Fill Color</Label>
              <div className="flex gap-2 items-center">
                <CustomColorPicker
                  value={backgroundColor}
                  onChange={setBackgroundColor}
                />
                <Input
                  value={backgroundColor}
                  onChange={(e) => setBackgroundColor(e.target.value)}
                  className="flex-1 bg-muted border-border text-foreground"
                />
              </div>
            </div>
          )}

          {/* Image Overlay Specific Fields */}
          {nodeType === "imageOverlayNode" && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-foreground/80">Local Image Path / URL</Label>
              <Input
                value={imagePath}
                onChange={(e) => setImagePath(e.target.value)}
                placeholder="C:\path\to\logo.png"
                className="bg-muted border-border text-foreground"
              />
            </div>
          )}

          {/* Visualizer Specific Fields */}
          {nodeType === "visualizerOverlayNode" && (
            <div className="flex flex-col gap-1.5">
              <Label className="text-foreground/80">Rendering Style</Label>
              <select
                value={visualizerType}
                onChange={(e) => setVisualizerType(e.target.value)}
                className="w-full bg-muted border border-border rounded-lg px-2.5 py-1.5 text-xs text-foreground focus:outline-none cursor-pointer"
              >
                <option value="bars">Frequency Bars</option>
                <option value="wave">Time-domain Wave (Oscilloscope)</option>
                <option value="circle">Circular Ring</option>
                <option value="blocks">LED Segments / Blocks</option>
                <option value="dots">Bouncing Dots</option>
              </select>
            </div>
          )}

          {/* Capture Source Specific Fields */}
          {nodeType === "captureSourceNode" && (
            <div className="flex items-center gap-2.5 py-1">
              <input
                id="prop-cap-audio"
                type="checkbox"
                checked={captureAudio}
                onChange={(e) => setCaptureAudio(e.target.checked)}
                className="rounded bg-muted border-border accent-indigo-500 cursor-pointer h-4 w-4"
              />
              <Label htmlFor="prop-cap-audio" className="text-foreground/80 cursor-pointer">
                Capture Source Audio Output
              </Label>
            </div>
          )}

          {/* Triggers Mappings Config Section */}
          {availableActions && (
            <div className="flex flex-col gap-3.5 border-t border-border/65 pt-4">
              <div className="flex justify-between items-center">
                <h5 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Configurable Hotkeys
                </h5>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setTriggers((prev) => [
                      ...prev,
                      {
                        id: Math.random().toString(36).substring(2, 9),
                        triggerKey: "",
                        action: availableActions[0]?.name || "",
                      },
                    ]);
                  }}
                  className="h-7 text-[10px] px-2.5 rounded-lg border-border bg-muted hover:bg-secondary text-foreground/80"
                >
                  Add Hotkey
                </Button>
              </div>

              {triggers.length === 0 ? (
                <p className="text-[11px] text-muted-foreground italic">
                  No hotkeys mapped yet. Click Add Hotkey above.
                </p>
              ) : (
                <div className="flex flex-col gap-2 max-h-48 overflow-y-auto pr-1">
                  {triggers.map((trigger) => (
                    <div key={trigger.id} className="flex items-center gap-2">
                      {/* Action dropdown selector */}
                      <select
                        value={trigger.action}
                        onChange={(e) => {
                          const val = e.target.value;
                          setTriggers((prev) =>
                            prev.map((t) => (t.id === trigger.id ? { ...t, action: val } : t))
                          );
                        }}
                        className="flex-1 bg-muted border border-border rounded-lg px-2 py-1 text-xs text-foreground focus:outline-none cursor-pointer h-8"
                      >
                        {availableActions.map((act) => (
                          <option key={act.name} value={act.name}>
                            {act.label}
                          </option>
                        ))}
                      </select>

                      {/* Hotkey binding recorder button */}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setRecordingTriggerId(trigger.id)}
                        className={cn(
                          "w-28 text-[11px] h-8 rounded-lg border-border truncate font-mono",
                          recordingTriggerId === trigger.id
                            ? "bg-amber-500/10 border-amber-500/30 text-amber-400 animate-pulse border-dashed"
                            : "bg-muted text-foreground/80 hover:bg-secondary"
                        )}
                      >
                        {recordingTriggerId === trigger.id ? "Press key..." : trigger.triggerKey || "Not Bound"}
                      </Button>

                      {/* Remove button */}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setTriggers((prev) => prev.filter((t) => t.id !== trigger.id));
                        }}
                        className="h-8 px-2.5 hover:bg-red-500/10 text-muted-foreground hover:text-red-400 rounded-lg"
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border/40">
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="hover:bg-muted hover:text-foreground">
            Cancel
          </Button>
          <Button onClick={handleSave} className="bg-indigo-600 hover:bg-indigo-500 text-white">
            Save Changes
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
