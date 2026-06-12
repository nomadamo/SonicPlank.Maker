import { Card, CardHeader, CardMedia } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Handle, NodeProps, Position } from "@xyflow/react";
import {
  Monitor as MonitorIcon,
  RefreshCw as RefreshCwIcon,
  Play as PlayIcon,
  Square as SquareIcon,
  Maximize2 as MaximizeIcon,
} from "lucide-react";
import { FlowNodeType } from "@/types/flow-node";
import { useSetAtom } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useScreenCapture } from "@/hooks/useScreenCapture";


export function ConfigurationNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const updateNodeData = useSetAtom(updateNodeDataAtom);
  const videoRef = useRef<HTMLVideoElement>(null);
  const popOutVideoRef = useRef<HTMLVideoElement>(null);
  const [isPreviewActive, setIsPreviewActive] = useState(false);
  const [isPopOutOpen, setIsPopOutOpen] = useState(false);

  const {
    sources,
    stream,
    loading: loadingSources,
    refreshSources,
    startCapture,
    stopCapture,
  } = useScreenCapture();

  // Query available displays and windows without thumbnails to avoid WGC error spam
  const fetchSources = useCallback(async () => {
    await refreshSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 0, height: 0 },
    });
  }, [refreshSources]);

  useEffect(() => {
    fetchSources();
  }, [fetchSources]);

  // Handle stream assignment to HTMLVideoElement
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch((err) => {
        console.error("[ConfigurationNode] Video playback failed:", err);
      });
    }
  }, [stream]);

  // Handle stream assignment to popout HTMLVideoElement
  useEffect(() => {
    if (popOutVideoRef.current && stream && isPopOutOpen) {
      popOutVideoRef.current.srcObject = stream;
      popOutVideoRef.current.play().catch((err) => {
        console.error("[ConfigurationNode] Popout video playback failed:", err);
      });
    }
  }, [stream, isPopOutOpen]);


  // Clean up if preview gets turned off or selected source is deleted/changed
  const handleTogglePreview = useCallback(async () => {
    if (isPreviewActive) {
      stopCapture();
      setIsPreviewActive(false);
    } else {
      if (!node.data.captureSourceId) return;
      setIsPreviewActive(true);
      const activeStream = await startCapture(
        node.data.captureSourceId,
        !!node.data.captureAudio
      );
      if (!activeStream) {
        setIsPreviewActive(false);
      }
    }
  }, [isPreviewActive, node.data.captureSourceId, node.data.captureAudio, startCapture, stopCapture]);

  const handleSourceChange = useCallback(
    (val: string) => {
      // If we are currently previewing, stop the active capture session first
      if (isPreviewActive) {
        stopCapture();
        setIsPreviewActive(false);
      }

      const selected = sources.find((s) => s.id === val);
      updateNodeData({
        id: node.id,
        patch: {
          captureSourceId: val,
          captureSourceName: selected ? selected.name : val,
        },
      });
    },
    [sources, node.id, updateNodeData, isPreviewActive, stopCapture]
  );

  const handleAudioToggle = useCallback(
    (checked: boolean) => {
      updateNodeData({
        id: node.id,
        patch: { captureAudio: checked },
      });
      // If we are currently previewing, restart capture to apply audio changes
      if (isPreviewActive && node.data.captureSourceId) {
        startCapture(node.data.captureSourceId, checked);
      }
    },
    [node.id, updateNodeData, isPreviewActive, startCapture]
  );

  const selectedSource = sources.find((s) => s.id === node.data.captureSourceId);
  const selectedLabel = selectedSource ? selectedSource.name : (node.data.captureSourceName || "Select capture source");

  return (
    <>
      <Card
        className={cn(
          "w-80 panel p-4 flex flex-col gap-4 select-none bg-zinc-950/95 backdrop-blur-md border border-zinc-800 text-white rounded-xl shadow-2xl"
        )}
        id={`flow-node-${node.id}`}
        style={{ anchorName: `--configNode_${node.id}` }}
      >
        {/* Header */}
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
            disabled={loadingSources}
            className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors disabled:opacity-50 nodrag nopan nowheel"
            title="Refresh sources"
          >
            <RefreshCwIcon className={cn("w-4 h-4", loadingSources && "animate-spin")} />
          </button>
        </div>

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
                      <img src={src.appIconUrl} className="w-4 h-4 object-contain" alt="" />
                    )}
                    <span className="truncate max-w-[200px]">{src.name}</span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Live Video Preview Area */}
        <div className="flex flex-col gap-1.5 nodrag nopan nowheel">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
              Live Preview
            </label>
            {node.data.captureSourceId && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleTogglePreview}
                  className={cn(
                    "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-all font-semibold uppercase tracking-wider cursor-pointer",
                    isPreviewActive
                      ? "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                      : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20"
                  )}
                >
                  {isPreviewActive ? (
                    <>
                      <SquareIcon className="w-2.5 h-2.5 fill-current" /> Stop
                    </>
                  ) : (
                    <>
                      <PlayIcon className="w-2.5 h-2.5 fill-current" /> Preview
                    </>
                  )}
                </button>

                {isPreviewActive && (
                  <button
                    onClick={() => setIsPopOutOpen(true)}
                    className="p-1 rounded bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                    title="Pop out preview"
                  >
                    <MaximizeIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="relative rounded-lg border border-zinc-800 overflow-hidden bg-black aspect-video flex items-center justify-center shadow-inner group">
            {isPreviewActive && stream ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-contain"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 text-zinc-500 text-center px-4 py-8">
                <MonitorIcon className="w-8 h-8 text-zinc-700 stroke-[1.5]" />
                <span className="text-[10px]">
                  {node.data.captureSourceId
                    ? "Click Preview to test stream"
                    : "Select a capture target above"}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Audio Toggle */}
        <div className="flex items-center justify-between border-t border-zinc-800/80 pt-3 mt-1 nodrag nopan nowheel">
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

      {/* Pop Out Large Preview Modal */}
      <Dialog open={isPopOutOpen} onOpenChange={setIsPopOutOpen}>
        <DialogContent className="max-w-5xl w-[90vw] aspect-video p-0 bg-black overflow-hidden border border-zinc-800 rounded-2xl shadow-2xl">
          <video
            ref={popOutVideoRef}
            autoPlay
            playsInline
            muted
            className="w-full h-full object-contain"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
