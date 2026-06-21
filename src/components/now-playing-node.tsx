import { BaseNodeCard } from "./base-node";
import { Handle, NodeProps, Position, useEdges, useNodes } from "@xyflow/react";
import { Music as MusicIcon } from "lucide-react";
import { FlowNodeType } from "@/types/flow-node";
import { useSetAtom, useAtomValue } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import { currentPlaybackAtom } from "@/store/libraryStore";
import { useAudioStore } from "@/lib/audio-store";
import { useCallback, useEffect, useMemo, useState } from "react";

const DEFAULTS = {
  x: 10,
  y: 10,
  width: 35,
  height: 12,
  opacity: 1,
};

function fromNodeData(data: FlowNodeType["data"]) {
  return {
    x: data.x !== undefined ? Number(data.x) : DEFAULTS.x,
    y: data.y !== undefined ? Number(data.y) : DEFAULTS.y,
    width: data.width !== undefined ? Number(data.width) : DEFAULTS.width,
    height: data.height !== undefined ? Number(data.height) : DEFAULTS.height,
    opacity:
      data.opacity !== undefined ? Number(data.opacity) : DEFAULTS.opacity,
  };
}

export function NowPlayingNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const updateNodeData = useSetAtom(updateNodeDataAtom);
  const edges = useEdges();
  const nodes = useNodes();

  const connectedAudioNode = useMemo(() => {
    const incomingEdge = edges.find(
      (e) =>
        e.target === node.id && e.targetHandle === `handle_${node.id}_target`,
    );
    if (!incomingEdge) return null;
    const foundNode = nodes.find(
      (n) => n.id === incomingEdge.source && n.type === "audioFlowNode",
    );
    return (foundNode as FlowNodeType) || null;
  }, [edges, nodes, node.id]);

  useEffect(() => {
    if (node.data.x === undefined) {
      updateNodeData({ id: node.id, patch: DEFAULTS });
    }
  }, [node.id, node.data.x, updateNodeData]);

  const handleUpdate = useCallback(
    (patch: Partial<FlowNodeType["data"]>) => {
      updateNodeData({ id: node.id, patch });
    },
    [node.id, updateNodeData],
  );

  const [draft, setDraft] = useState(() => fromNodeData(node.data));
  const committed = useMemo(() => fromNodeData(node.data), [node.data]);

  useEffect(() => {
    setDraft(fromNodeData(node.data));
  }, [node.data]);

  const isDirty = (Object.keys(draft) as Array<keyof typeof draft>).some(
    (k) => draft[k] !== committed[k],
  );

  const set = useCallback(
    <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => {
      setDraft((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleApply = useCallback(() => {
    handleUpdate(draft);
  }, [draft, handleUpdate]);

  const [playbackTime, setPlaybackTime] = useState(0);

  const globalCurrentTrack = useAudioStore(s => s.currentTrack);
  const globalCurrentTime = useAudioStore(s => s.currentTime);
  const spotifyPlayback = useAtomValue(currentPlaybackAtom);

  useEffect(() => {
    if (!connectedAudioNode) {
      setPlaybackTime(0);
      return;
    }
    const onTimeUpdated = (nodeId: string, currentTime: number) => {
      if (nodeId === connectedAudioNode.id) setPlaybackTime(currentTime);
    };
    window.electron.onAudioTimeUpdated(onTimeUpdated);
    return () => {
      window.electron.removeOnAudioTimeUpdated();
    };
  }, [connectedAudioNode]);

  const formatTime = (seconds: number): string => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const isSpotify = !connectedAudioNode && spotifyPlayback && spotifyPlayback.isPlaying;
  const isLocalGlobal = !connectedAudioNode && !isSpotify && globalCurrentTrack;

  const title = connectedAudioNode?.data.title 
    || (isSpotify ? spotifyPlayback.title : isLocalGlobal ? globalCurrentTrack.title : "No Track Connected");
  const artist = connectedAudioNode?.data.artist 
    || (isSpotify ? spotifyPlayback.artist : isLocalGlobal ? globalCurrentTrack.artist : "Connect Audio Source");
  const duration = connectedAudioNode?.data.duration 
    || (isSpotify ? spotifyPlayback.duration : isLocalGlobal ? globalCurrentTrack.duration : 0);
  const albumArt = connectedAudioNode?.data.albumArt 
    || (isSpotify ? spotifyPlayback.albumArt : isLocalGlobal ? "" : ""); // Local items don't have album art yet
  
  const currentDisplayTime = connectedAudioNode 
    ? playbackTime 
    : isSpotify 
      ? spotifyPlayback.progress_ms / 1000 
      : isLocalGlobal 
        ? globalCurrentTime 
        : 0;

  const progressPercent = duration > 0 ? (currentDisplayTime / duration) * 100 : 0;

  return (
    <>
      <Handle
        id={`handle_${node.id}_target`}
        type="target"
        position={Position.Left}
        isConnectable={node.isConnectable}
        style={{ top: "34px" }}
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
          {/* Card Visual Preview */}
          <div className="relative overflow-hidden rounded-xl bg-zinc-950/80 border border-zinc-800/80 p-3 flex items-center gap-3 shadow-lg backdrop-blur-md">
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
            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div className="text-xs font-bold text-zinc-100 truncate tracking-wide">
                {title}
              </div>
              <div className="text-[10px] text-zinc-400 truncate">{artist}</div>
              <div className="w-full flex items-center gap-2 mt-1">
                <div className="flex-1 h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-500 rounded-full transition-all duration-100 ease-out"
                    style={{ width: `${Math.min(100, progressPercent)}%` }}
                  />
                </div>
                <div className="text-[9px] font-medium text-zinc-400 tabular-nums flex-shrink-0">
                  {formatTime(currentDisplayTime)} / {formatTime(duration)}
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
                value={draft.x}
                onChange={(e) => set("x", Number(e.target.value) || 0)}
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
                value={draft.y}
                onChange={(e) => set("y", Number(e.target.value) || 0)}
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
                value={draft.width}
                onChange={(e) => set("width", Number(e.target.value) || 0)}
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
                value={draft.height}
                onChange={(e) => set("height", Number(e.target.value) || 0)}
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
                {Math.round(draft.opacity * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={draft.opacity}
              onChange={(e) => set("opacity", Number(e.target.value))}
              className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
            />
          </div>

          {isDirty && (
            <button
              onClick={handleApply}
              className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded cursor-pointer transition-colors mt-1"
            >
              Apply
            </button>
          )}
        </div>
      </BaseNodeCard>
      <Handle
        id={`handle_${node.id}_source`}
        type="source"
        style={{ top: "34px" }}
        position={Position.Right}
        isConnectable={node.isConnectable}
        className="hover:!border-indigo-400 hover:!shadow-[0_0_10px_rgba(129,140,248,0.5)] hover:!scale-125"
      />
    </>
  );
}
