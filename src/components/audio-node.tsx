import { BaseNodeCard } from "./base-node";
import { cn } from "@/lib/utils";
import { Handle, NodeProps, Position } from "@xyflow/react";
import {
  Music as MusicIcon,
  Play as PlayIcon,
  Pause as PauseIcon,
  VolumeX as MuteIcon,
  Volume2 as UnmuteIcon,
} from "lucide-react";
import { FlowNodeType } from "@/types/flow-node";
import { useSetAtom } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import { useTransientNodeState } from "@/store/transientNodeStore";
import { useCallback, useEffect } from "react";

import {
  getOrCreateFlowAudio,
  removeFlowAudio,
} from "@/utils/flowAudioRegistry";

export function AudioNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const updateNodeData = useSetAtom(updateNodeDataAtom);
  const { getVal, setVal } = useTransientNodeState(node.id, "audioFlowNode");

  const handleVolumeChange = useCallback(
    (volume: number) => {
      updateNodeData({ id: node.id, patch: { volume } });
    },
    [node.id, updateNodeData],
  );

  const isPlayingVal = getVal<boolean>("isPlaying");

  const togglePlayState = useCallback(() => {
    setVal("isPlaying", !isPlayingVal);
  }, [isPlayingVal, setVal]);

  const toggleMuteState = useCallback(() => {
    updateNodeData({ id: node.id, patch: { isMuted: !node.data.isMuted } });
  }, [node.id, node.data.isMuted, updateNodeData]);

  const volumeVal =
    node.data.volume !== undefined ? Number(node.data.volume) : 1;
  const isMutedVal = !!node.data.isMuted;
  const trackTitle = (node.data.title as string) || "Unknown Title";
  const trackArtist = (node.data.artist as string) || "Unknown Artist";
  const mediaPath = (node.data.mediaPath as string) || "";
  const duration =
    node.data.duration !== undefined ? Number(node.data.duration) : 0;

  // Sync state to flowAudioRegistry reactively
  useEffect(() => {
    if (!mediaPath) return;

    const flowAudio = getOrCreateFlowAudio(node.id, mediaPath);
    if (flowAudio) {
      // Sync volume
      const targetVolume = isMutedVal ? 0 : volumeVal;
      if (flowAudio.gainNode.gain.value !== targetVolume) {
        flowAudio.gainNode.gain.value = targetVolume;
      }

      // Sync play/pause state
      if (isPlayingVal) {
        if (flowAudio.audio.paused) {
          flowAudio.audio.play().catch((err) => {
            console.error(
              `[AudioNode] Playback failed for node ${node.id}:`,
              err,
            );
            // If play fails (e.g. browser autoplay restriction), update state to false
            setVal("isPlaying", false);
          });
        }
      } else {
        if (!flowAudio.audio.paused) {
          flowAudio.audio.pause();
        }
      }
    }
  }, [node.id, mediaPath, isPlayingVal, volumeVal, isMutedVal, setVal]);

  // Clean up audio resources on unmount
  useEffect(() => {
    return () => {
      removeFlowAudio(node.id);
    };
  }, [node.id]);

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
        title="Audio Source"
        subtitle="Local track asset"
        anchorName={`--audioFlowNode_${node.id}`}
      >
        {/* Metadata Details & Interactive Controls */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800/40">
          {/* Play / Pause Toggle Button */}
          <button
            onClick={togglePlayState}
            disabled={!mediaPath}
            className={cn(
              "p-2.5 rounded-full flex items-center justify-center transition-all duration-150 nodrag nopan nowheel border shadow-md",
              !mediaPath
                ? "bg-zinc-800/40 border-zinc-800 text-zinc-600 cursor-not-allowed"
                : isPlayingVal
                  ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20 hover:scale-105 cursor-pointer"
                  : "bg-zinc-900 border-zinc-800 text-zinc-200 hover:bg-zinc-800 hover:scale-105 cursor-pointer",
            )}
          >
            {isPlayingVal ? (
              <PauseIcon className="w-4 h-4 fill-emerald-400/20" />
            ) : (
              <PlayIcon className="w-4 h-4 fill-zinc-200/20" />
            )}
          </button>

          <div className="flex-1 min-w-0 flex flex-col gap-0.5">
            <div
              className="text-xs font-semibold text-zinc-200 truncate"
              title={trackTitle}
            >
              {trackTitle}
            </div>
            <div className="flex justify-between items-center text-[10px] text-zinc-400">
              <span className="truncate max-w-[110px]" title={trackArtist}>
                {trackArtist}
              </span>
              <span>{formatDuration(duration)}</span>
            </div>
          </div>
        </div>

        {/* Volume Slider & Mute Toggle */}
        <div className="flex flex-col gap-1.5 nodrag nopan nowheel">
          <div className="flex justify-between items-center">
            <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-1">
              <button
                onClick={toggleMuteState}
                disabled={!mediaPath}
                className="hover:text-zinc-200 transition-colors p-0.5 rounded cursor-pointer"
              >
                {isMutedVal ? (
                  <MuteIcon className="w-3.5 h-3.5 text-zinc-500" />
                ) : (
                  <UnmuteIcon className="w-3.5 h-3.5 text-zinc-400" />
                )}
              </button>
              Volume
            </label>
            <span className="text-[11px] text-zinc-400">
              {isMutedVal ? "Muted" : `${Math.round(volumeVal * 100)}%`}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={isMutedVal ? 0 : volumeVal}
            onChange={(e) => handleVolumeChange(Number(e.target.value))}
            disabled={isMutedVal || !mediaPath}
            className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-emerald-500 focus:outline-none disabled:opacity-40"
          />
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
