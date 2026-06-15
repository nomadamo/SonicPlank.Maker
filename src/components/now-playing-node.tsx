import { BaseNodeCard } from "./base-node";
import { cn } from "@/lib/utils";
import { Handle, NodeProps, Position, useEdges, useNodes } from "@xyflow/react";
import { Music as MusicIcon } from "lucide-react";
import { FlowNodeType } from "@/types/flow-node";
import { useSetAtom } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import { useCallback, useEffect, useMemo, useState } from "react";

export function NowPlayingNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const updateNodeData = useSetAtom(updateNodeDataAtom);
  const edges = useEdges();
  const nodes = useNodes();

  // 1. Locate the connected audio node
  const connectedAudioNode = useMemo(() => {
    const incomingEdge = edges.find(
      (e) =>
        e.target === node.id &&
        e.targetHandle === `handle_${node.id}_target`,
    );
    if (!incomingEdge) return null;
    const foundNode = nodes.find(
      (n) => n.id === incomingEdge.source && n.type === "audioFlowNode",
    );
    return (foundNode as FlowNodeType) || null;
  }, [edges, nodes, node.id]);

  // 2. Initialize default parameters if they don't exist
  useEffect(() => {
    if (node.data.x === undefined) {
      updateNodeData({
        id: node.id,
        patch: {
          x: 10,
          y: 10,
          width: 35,
          height: 12,
          opacity: 1,
        },
      });
    }
  }, [node.id, node.data.x, updateNodeData]);

  const handleUpdate = useCallback(
    (patch: Partial<FlowNodeType["data"]>) => {
      updateNodeData({ id: node.id, patch });
    },
    [node.id, updateNodeData],
  );

  const xVal = node.data.x !== undefined ? Number(node.data.x) : 10;
  const yVal = node.data.y !== undefined ? Number(node.data.y) : 10;
  const wVal = node.data.width !== undefined ? Number(node.data.width) : 35;
  const hVal = node.data.height !== undefined ? Number(node.data.height) : 12;
  const opacityVal =
    node.data.opacity !== undefined ? Number(node.data.opacity) : 1;

  // Track playback time of the connected audio node
  const [playbackTime, setPlaybackTime] = useState(0);

  useEffect(() => {
    if (!connectedAudioNode) {
      setPlaybackTime(0);
      return;
    }

    const onTimeUpdated = (nodeId: string, currentTime: number) => {
      if (nodeId === connectedAudioNode.id) {
        setPlaybackTime(currentTime);
      }
    };

    window.electron.onAudioTimeUpdated(onTimeUpdated);

    return () => {
      window.electron.removeOnAudioTimeUpdated();
    };
  }, [connectedAudioNode]);

  // Format MM:SS helper
  const formatTime = (seconds: number): string => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const title = connectedAudioNode?.data.title || "No Track Connected";
  const artist = connectedAudioNode?.data.artist || "Connect Audio Source";
  const duration = connectedAudioNode?.data.duration || 0;
  const albumArt = connectedAudioNode?.data.albumArt || "";

  const progressPercent = duration > 0 ? (playbackTime / duration) * 100 : 0;

  return (
    <>
      <Handle
        id={`handle_${node.id}_target`}
        type="target"
        position={Position.Left}
        isConnectable={node.isConnectable}
        className="hover:!border-emerald-400 hover:!shadow-[0_0_10px_rgba(52,211,153,0.5)] hover:!scale-125"
      />
      <BaseNodeCard
        id={node.id}
        selected={node.selected}
        isMinimized={!!node.data.isMinimized}
        borderColor="indigo"
        iconColor="indigo"
        icon={MusicIcon}
        title="Now Playing Overlay"
        subtitle="Current track overlay HUD"
        anchorName={`--nowPlayingNode_${node.id}`}
      >
        <div className="flex flex-col gap-3.5 nodrag nopan nowheel">
          {/* Card Visual Preview (Premium OBS style overlay mockup) */}
          <div className="relative overflow-hidden rounded-xl bg-zinc-950/80 border border-zinc-800/80 p-3 flex items-center gap-3 shadow-lg backdrop-blur-md">
            {/* Album Cover Thumbnail */}
            <div className="relative w-12 h-12 rounded-lg bg-zinc-900 border border-zinc-800/60 overflow-hidden flex items-center justify-center flex-shrink-0">
              {albumArt ? (
                <img
                  src={albumArt}
                  className="w-full h-full object-cover select-none pointer-events-none"
                  alt="Album Art"
                />
              ) : (
                <MusicIcon className="w-5 h-5 text-zinc-600 animate-pulse" />
              )}
            </div>

            {/* Metadata Text */}
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="text-xs font-bold text-zinc-100 truncate tracking-wide">
                {title}
              </div>
              <div className="text-[10px] text-zinc-400 truncate">
                {artist}
              </div>

              {/* Progress Line */}
              <div className="w-full flex items-center gap-2 mt-1">
                <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all duration-100 ease-out"
                    style={{ width: `${Math.min(100, progressPercent)}%` }}
                  />
                </div>
                <div className="text-[9px] font-medium text-zinc-400 tabular-nums flex-shrink-0">
                  {formatTime(playbackTime)} / {formatTime(duration)}
                </div>
              </div>
            </div>
          </div>

          {/* Coordinates Grid */}
          <div className="grid grid-cols-2 gap-2 border-t border-zinc-800/40 pt-2.5">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                Position X (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={xVal}
                onChange={(e) =>
                  handleUpdate({ x: Number(e.target.value) || 0 })
                }
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                Position Y (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={yVal}
                onChange={(e) =>
                  handleUpdate({ y: Number(e.target.value) || 0 })
                }
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                Width (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={wVal}
                onChange={(e) =>
                  handleUpdate({ width: Number(e.target.value) || 0 })
                }
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                Height (%)
              </label>
              <input
                type="number"
                min="0"
                max="100"
                value={hVal}
                onChange={(e) =>
                  handleUpdate({ height: Number(e.target.value) || 0 })
                }
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Opacity Slider */}
          <div className="flex flex-col gap-1 border-t border-zinc-800/40 pt-2.5">
            <div className="flex justify-between items-center">
              <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                Opacity
              </label>
              <span className="text-[10px] text-zinc-400">
                {Math.round(opacityVal * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={opacityVal}
              onChange={(e) => handleUpdate({ opacity: Number(e.target.value) })}
              className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
            />
          </div>
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
