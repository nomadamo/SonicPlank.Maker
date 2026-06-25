import { BaseNodeCard } from "./base-node";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { Music as MusicIcon, Play as PlayIcon, Pause as PauseIcon } from "lucide-react";
import { FlowNodeType } from "@/types/flow-node";
import { useAtomValue, useSetAtom } from "jotai";
import { currentPlaybackAtom } from "@/store/libraryStore";
import { updateNodeDataAtom } from "@/store/flowStore";
import { useEffect } from "react";

export function GlobalAudioNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const currentPlayback = useAtomValue(currentPlaybackAtom);
  const updateNodeData = useSetAtom(updateNodeDataAtom);

  const trackTitle = currentPlayback?.title || "No Track Playing";
  const trackArtist = currentPlayback?.artist || "—";
  const isPlaying = currentPlayback?.isPlaying || false;
  const duration = currentPlayback?.duration || 0;
  const albumArt = currentPlayback?.albumArt || "";

  useEffect(() => {
    updateNodeData({
      id: node.id,
      patch: {
        title: trackTitle,
        artist: trackArtist,
        albumArt,
        duration,
        isPlaying,
      },
    });
  }, [node.id, trackTitle, trackArtist, albumArt, duration, isPlaying, updateNodeData]);

  const formatDuration = (seconds: number): string => {
    if (!seconds) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  return (
    <>
      <BaseNodeCard
        id={node.id}
        selected={node.selected}
        isMinimized={!!node.data.isMinimized}
        borderColor="emerald"
        iconColor="emerald"
        icon={MusicIcon}
        title="Global Audio"
        subtitle="Currently playing track"
        anchorName={`--globalAudioNode_${node.id}`}
      >
        <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 border border-border/40 nodrag nopan nowheel">
          {/* Status Icon */}
          <div className="p-2.5 rounded-full flex items-center justify-center border shadow-md bg-muted border-border text-emerald-400">
            {isPlaying ? (
              <PlayIcon className="w-4 h-4 fill-emerald-400/20" />
            ) : (
              <PauseIcon className="w-4 h-4 fill-zinc-500/20 text-muted-foreground" />
            )}
          </div>

          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div
              className="text-xs font-semibold text-foreground truncate"
              title={trackTitle}
            >
              {trackTitle}
            </div>
            <div className="flex justify-between items-center text-[10px] text-muted-foreground">
              <span className="truncate max-w-[110px]" title={trackArtist}>
                {trackArtist}
              </span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>
        </div>
      </BaseNodeCard>
      <Handle
        id={`handle_${node.id}_source`}
        type="source"
        position={Position.Right}
        isConnectable={node.isConnectable}
        className="hover:!border-emerald-400 hover:!shadow-[0_0_10px_rgba(52,211,153,0.5)] hover:!scale-125"
      />
    </>
  );
}
