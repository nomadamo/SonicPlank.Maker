import { BaseNodeCard } from "./base-node";
import { cn } from "@/lib/utils";
import { Handle, NodeProps, Position } from "@xyflow/react";
import {
  Monitor as MonitorIcon,
  RefreshCw as RefreshCwIcon,
} from "lucide-react";
import { FlowNodeType } from "@/types/flow-node";
import { useSetAtom } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import { useCallback, useEffect, useState, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useScreenCapture } from "@/hooks/useScreenCapture";

function getDisplayForSourceId(sourceId: string, displaysList: any[]) {
  if (!sourceId || !sourceId.startsWith("screen:")) return null;
  const idStr = sourceId.replace("screen:", "");

  // Try direct match by display.id
  const matchById = displaysList.find((d) => String(d.id) === idStr);
  if (matchById) return matchById;

  // Fallback to match by index
  const index = parseInt(idStr, 10);
  if (!isNaN(index) && index >= 0 && index < displaysList.length) {
    return displaysList[index];
  }

  return displaysList.find((d) => d.isPrimary) || displaysList[0];
}

export function CaptureSourceNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const updateNodeData = useSetAtom(updateNodeDataAtom);
  const [displays, setDisplays] = useState<any[]>([]);

  const {
    sources,
    loading: loadingSources,
    refreshSources,
  } = useScreenCapture();

  // Query physical displays
  const fetchDisplays = useCallback(async () => {
    try {
      const physicalDisplays = await window.electron.getDisplays();
      setDisplays(physicalDisplays);
    } catch (err) {
      console.error(
        "[CaptureSourceNode] Failed to fetch physical displays:",
        err,
      );
    }
  }, []);

  // Query available displays and windows
  const fetchSources = useCallback(async () => {
    await refreshSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 0, height: 0 },
    });
  }, [refreshSources]);

  useEffect(() => {
    const load = async () => {
      await fetchSources();
      await fetchDisplays();
    };
    load();
  }, [fetchSources, fetchDisplays]);

  // Dynamically calculate resolution presets based on target monitor dimensions
  const resolutionPresets = useMemo(() => {
    if (
      node.data.captureSourceId?.startsWith("screen:") &&
      displays.length > 0
    ) {
      const activeDisplay = getDisplayForSourceId(
        node.data.captureSourceId,
        displays,
      );
      if (activeDisplay) {
        const w = activeDisplay.bounds.width;
        const h = activeDisplay.bounds.height;
        const ratio = w / h;

        let aspectString = "auto";
        if (Math.abs(ratio - 16 / 9) < 0.01) aspectString = "16/9";
        else if (Math.abs(ratio - 21 / 9) < 0.05) aspectString = "21/9";
        else if (Math.abs(ratio - 16 / 10) < 0.01) aspectString = "16/10";
        else if (Math.abs(ratio - 4 / 3) < 0.01) aspectString = "4/3";
        else aspectString = `${w}/${h}`;

        return {
          original: {
            label: `Original (${w}x${h})`,
            aspect: aspectString,
            width: w,
            height: h,
          },
          scale_75: {
            label: `75% Scale (${Math.round(w * 0.75)}x${Math.round(h * 0.75)})`,
            aspect: aspectString,
            width: Math.round(w * 0.75),
            height: Math.round(h * 0.75),
          },
          scale_50: {
            label: `50% Scale (${Math.round(w * 0.5)}x${Math.round(h * 0.5)})`,
            aspect: aspectString,
            width: Math.round(w * 0.5),
            height: Math.round(h * 0.5),
          },
          hd: {
            label: "16:9 HD (1280x720)",
            aspect: "16/9",
            width: 1280,
            height: 720,
          },
          fhd: {
            label: "16:9 Full HD (1920x1080)",
            aspect: "16/9",
            width: 1920,
            height: 1080,
          },
        };
      }
    }

    return {
      original: {
        label: "Original / Fit Window",
        aspect: "auto",
        width: undefined,
        height: undefined,
      },
      hd: {
        label: "16:9 HD (1280x720)",
        aspect: "16/9",
        width: 1280,
        height: 720,
      },
      fhd: {
        label: "16:9 Full HD (1920x1080)",
        aspect: "16/9",
        width: 1920,
        height: 1080,
      },
      uwhd: {
        label: "21:9 UWHD (2560x1080)",
        aspect: "21/9",
        width: 2560,
        height: 1080,
      },
      uwqhd: {
        label: "21:9 UWQHD (3440x1440)",
        aspect: "21/9",
        width: 3440,
        height: 1440,
      },
    };
  }, [node.data.captureSourceId, displays]);

  const resolutionKey =
    node.data.captureResolution &&
    node.data.captureResolution in resolutionPresets
      ? node.data.captureResolution
      : "original";
  const activePreset =
    resolutionPresets[resolutionKey as keyof typeof resolutionPresets] ||
    resolutionPresets.original;

  const handleSourceChange = useCallback(
    (val: string) => {
      const selected = sources.find((s) => s.id === val);
      updateNodeData({
        id: node.id,
        patch: {
          captureSourceId: val,
          captureSourceName: selected ? selected.name : val,
        },
      });
    },
    [sources, node.id, updateNodeData],
  );

  const handleResolutionChange = useCallback(
    (val: string) => {
      updateNodeData({
        id: node.id,
        patch: { captureResolution: val },
      });
    },
    [node.id, updateNodeData],
  );

  const handleMaxFrameRateChange = useCallback(
    (val: string) => {
      updateNodeData({
        id: node.id,
        patch: { maxCaptureFrameRate: parseInt(val, 10) },
      });
    },
    [node.id, updateNodeData],
  );

  const handleAudioToggle = useCallback(
    (checked: boolean) => {
      updateNodeData({
        id: node.id,
        patch: { captureAudio: checked },
      });
    },
    [node.id, updateNodeData],
  );

  const selectedSource = sources.find(
    (s) => s.id === node.data.captureSourceId,
  );
  const selectedLabel = selectedSource
    ? selectedSource.name
    : node.data.captureSourceName || "Select capture source";

  return (
    <>
      <BaseNodeCard
        id={node.id}
        selected={node.selected}
        isMinimized={!!node.data.isMinimized}
        borderColor="indigo"
        iconColor="indigo"
        icon={MonitorIcon}
        title="Capture Source"
        subtitle="Select display/window"
        anchorName={`--captureSourceNode_${node.id}`}
        headerActions={
          <button
            onClick={fetchSources}
            disabled={loadingSources}
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors disabled:opacity-50 cursor-pointer"
            title="Refresh sources"
          >
            <RefreshCwIcon
              className={cn("w-4 h-4", loadingSources && "animate-spin")}
            />
          </button>
        }
      >
        {/* Display / Window Selector */}
        <div className="flex flex-col gap-1.5 nodrag nopan nowheel">
          <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
            Capture Target
          </label>
          <Select
            value={node.data.captureSourceId || ""}
            onValueChange={(val) => {
              if (typeof val === "string") {
                handleSourceChange(val);
              }
            }}
          >
            <SelectTrigger className="w-full h-9 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-between px-3 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-zinc-200">
              <SelectValue placeholder="Select capture source">
                {selectedLabel}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-zinc-950 border border-zinc-800 rounded-lg p-1 max-h-60 overflow-y-auto shadow-xl">
              {sources.length === 0 ? (
                <div className="text-xs text-zinc-400 p-3 text-center">
                  No displays or windows found
                </div>
              ) : (
                sources.map((src) => (
                  <SelectItem
                    key={src.id}
                    value={src.id}
                    className="flex items-center gap-2 p-2 hover:bg-zinc-900 rounded cursor-pointer text-sm text-zinc-300"
                  >
                    {src.appIconUrl && (
                      <img
                        src={src.appIconUrl}
                        className="w-4 h-4 object-contain"
                        alt=""
                      />
                    )}
                    <span className="truncate max-w-[200px]">{src.name}</span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Aspect Ratio / Resolution Selector */}
        <div className="flex flex-col gap-1.5 nodrag nopan nowheel">
          <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
            Aspect Ratio / Resolution
          </label>
          <Select
            value={resolutionKey}
            onValueChange={(val) => {
              if (val) {
                handleResolutionChange(val);
              }
            }}
          >
            <SelectTrigger className="w-full h-9 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-between px-3 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-zinc-200">
              <SelectValue placeholder="Select aspect/resolution">
                {activePreset.label}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-zinc-950 border border-zinc-800 rounded-lg p-1 max-h-60 overflow-y-auto shadow-xl">
              {Object.entries(resolutionPresets).map(([key, preset]) => (
                <SelectItem
                  key={key}
                  value={key}
                  className="flex items-center p-2 hover:bg-zinc-900 rounded cursor-pointer text-sm text-zinc-300"
                >
                  {preset.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Audio Toggle */}
        <div className="flex items-center justify-between border-t border-zinc-800/80 pt-3 mt-1 nodrag nopan nowheel">
          <div className="flex flex-col">
            <span className="text-xs font-medium text-zinc-200">
              Capture System Audio
            </span>
            <span className="text-[10px] text-zinc-400">
              Capture window or desktop audio stream
            </span>
          </div>
          <Switch
            checked={!!node.data.captureAudio}
            onCheckedChange={handleAudioToggle}
          />
        </div>

        {/* Frame rate*/}
        <div className="flex flex-col gap-1.5 nodrag nopan nowheel">
          <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
            Maximum FPS
          </label>
          <Select
            value={{
              value: node.data.maxCaptureFrameRate || 30,
              label: node.data.maxCaptureFrameRate?.toString() || "30",
            }}
            multiple={false}
            onValueChange={(val) => {
              if (typeof val === "string") {
                handleMaxFrameRateChange(val);
              }
            }}
          >
            <SelectTrigger className="w-full h-9 bg-zinc-900 border border-zinc-800 rounded-lg flex items-center justify-between px-3 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 text-zinc-200">
              <SelectValue placeholder="Select a max frame rate">
                {node.data.maxCaptureFrameRate?.toString()}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-zinc-950 border border-zinc-800 rounded-lg p-1 max-h-60 overflow-y-auto shadow-xl">
              {[0, 30, 60, 120].map((value) => (
                <SelectItem
                  key={value}
                  value={value.toString()}
                  className="flex items-center p-2 hover:bg-zinc-900 rounded cursor-pointer text-sm text-zinc-300"
                >
                  {value === 0 ? "No limit" : value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </BaseNodeCard>
      <Handle
        id={`handle_${node.id}_source`}
        type="source"
        position={Position.Right}
        isConnectable={node.isConnectable}
        className="hover:!border-indigo-400 hover:!shadow-[0_0_10px_rgba(129,140,248,0.5)] hover:!scale-125"
      />
    </>
  );
}
