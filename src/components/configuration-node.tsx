import { Card, CardHeader, CardMedia } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { Monitor as MonitorIcon, RefreshCw as RefreshCwIcon } from "lucide-react";
import { FlowNodeType } from "@/types/flow-node";
import { useSetAtom } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import { useCallback, useEffect, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ScreenCaptureSource } from "@/global";

export function ConfigurationNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const updateNodeData = useSetAtom(updateNodeDataAtom);
  const [sources, setSources] = useState<ScreenCaptureSource[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSources = useCallback(async () => {
    setLoading(true);
    try {
      const screenSources = await window.electron.getScreenSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 300, height: 200 },
      });
      setSources(screenSources);
    } catch (err) {
      console.error("[ConfigurationNode] Failed to fetch screen sources:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

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
    [sources, node.id, updateNodeData]
  );

  const handleAudioToggle = useCallback(
    (checked: boolean) => {
      updateNodeData({
        id: node.id,
        patch: { captureAudio: checked },
      });
    },
    [node.id, updateNodeData]
  );

  const selectedSource = sources.find((s) => s.id === node.data.captureSourceId);
  const selectedLabel = selectedSource ? selectedSource.name : (node.data.captureSourceName || "Select capture source");

  return (
    <>
      <Card
        className={cn("w-80 panel p-4 flex flex-col gap-4 select-none bg-zinc-950/90 backdrop-blur-md border border-zinc-800 text-white rounded-xl shadow-2xl")}
        id={`flow-node-${node.id}`}
        style={{ anchorName: `--configNode_${node.id}` }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-500/10 border border-indigo-500/20">
              <MonitorIcon className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-zinc-100">Screen Capture</h4>
              <p className="text-[11px] text-zinc-400">Configure capture source</p>
            </div>
          </div>
          <button
            onClick={fetchSources}
            disabled={loading}
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors disabled:opacity-50"
            title="Refresh sources"
          >
            <RefreshCwIcon className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        </div>

        {/* Display / Window Selector */}
        <div className="flex flex-col gap-1.5">
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
                      <img src={src.appIconUrl} className="w-4 h-4 object-contain" alt="" />
                    )}
                    <span className="truncate max-w-[200px]">{src.name}</span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Live Thumbnail Preview */}
        {selectedSource?.thumbnailUrl && (
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
              Preview
            </label>
            <div className="relative rounded-lg border border-zinc-800 overflow-hidden bg-black aspect-video flex items-center justify-center shadow-inner group">
              <img
                src={selectedSource.thumbnailUrl}
                className="max-h-full max-w-full object-contain transition-transform group-hover:scale-105"
                alt="Source preview"
              />
              <div className="absolute inset-0 bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            </div>
          </div>
        )}

        {/* Audio Toggle */}
        <div className="flex items-center justify-between border-t border-zinc-800/80 pt-3 mt-1">
          <div className="flex flex-col">
            <span className="text-xs font-medium text-zinc-200">Capture System Audio</span>
            <span className="text-[10px] text-zinc-400">Capture window or desktop audio stream</span>
          </div>
          <Switch
            checked={!!node.data.captureAudio}
            onCheckedChange={handleAudioToggle}
          />
        </div>
      </Card>
      <Handle
        id={`handle_${node.id}_source`}
        type="source"
        position={Position.Right}
        isConnectable={true}
      />
    </>
  );
}
