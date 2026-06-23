import { TimelineTrack } from "@/types/timeline";
import { Clip } from "./Clip";
import { Volume2, VolumeX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Knob } from "@/components/audio/knob";
import { LevelMeter } from "./LevelMeter";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Trash2Icon, Edit2Icon } from "lucide-react";
import { TimelineClip } from "@/types/timeline";
import { useAtom } from "jotai";
import { timelineSelectionAtom } from "@/store/timelineStore";

interface TrackProps {
  track: TimelineTrack;
  pixelsPerSecond: number;
  onDropItem: (trackId: string, item: any, xPosition: number) => void;
  onRemoveTrack?: (trackId: string) => void;
  onRenameTrack?: (trackId: string, newName: string) => void;
  onUpdateClip?: (
    trackId: string,
    clipId: string,
    updates: Partial<TimelineClip>,
  ) => void;
  onRemoveClip?: (trackId: string, clipId: string) => void;
  onSplitClip?: (trackId: string, clipId: string, time: number) => void;
  onUpdateTrack?: (trackId: string, updates: Partial<TimelineTrack>) => void;
  onMoveClipToTrack?: (
    clipId: string,
    sourceTrackId: string,
    targetTrackId: string,
    newStartTime: number,
  ) => void;
  onSeek?: (time: number) => void;
}

export function Track({
  track,
  pixelsPerSecond,
  onDropItem,
  onRemoveTrack,
  onRenameTrack,
  onUpdateClip,
  onRemoveClip,
  onSplitClip,
  onUpdateTrack,
  onMoveClipToTrack,
  onSeek,
}: TrackProps) {
  const [isRenaming, setIsRenaming] = useState(false);
  const [editName, setEditName] = useState(track.name);
  const inputRef = useRef<HTMLInputElement>(null);
  
  const [selection, setSelection] = useAtom(timelineSelectionAtom);
  const trackBodyRef = useRef<HTMLDivElement>(null);
  
  const selectionStartRef = useRef<number>(0);
  const activeSelectionClipRef = useRef<TimelineClip | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (trackBodyRef.current) {
      // Don't start selection if clicking on the clip label (drag handle) or resize handles
      const target = e.target as HTMLElement;
      if (target.closest('.cursor-grab') || target.closest('.cursor-col-resize')) {
        return;
      }
      
      const rect = trackBodyRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = Math.max(0, x / pixelsPerSecond);
      
      // Find the clip under the cursor
      const clickedClip = track.clips.find(
        (c) => time >= c.startTime && time <= c.startTime + c.duration
      );

      if (!clickedClip) {
        // Did not click on a clip, abort selection
        setSelection(null);
        return;
      }

      e.preventDefault();
      
      activeSelectionClipRef.current = clickedClip;
      selectionStartRef.current = time;
      setIsSelecting(true);
      setSelection({ trackId: track.id, start: time, end: time });
      onSeek?.(time);
    }
  }, [pixelsPerSecond, setSelection, onSeek, track.id, track.clips]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (isSelecting && trackBodyRef.current && activeSelectionClipRef.current) {
      const rect = trackBodyRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      let time = Math.max(0, x / pixelsPerSecond);
      
      // Clamp to clip bounds
      const clip = activeSelectionClipRef.current;
      time = Math.max(clip.startTime, Math.min(clip.startTime + clip.duration, time));
      
      setSelection({
        trackId: track.id,
        start: Math.min(selectionStartRef.current, time),
        end: Math.max(selectionStartRef.current, time),
      });
    }
  }, [isSelecting, pixelsPerSecond, setSelection, track.id]);

  const handlePointerUp = useCallback(() => {
    if (isSelecting) {
      setIsSelecting(false);
      activeSelectionClipRef.current = null;
    }
  }, [isSelecting]);

  // Catch releases outside the track
  useEffect(() => {
    const handleGlobalUp = () => {
      if (isSelecting) {
        setIsSelecting(false);
        activeSelectionClipRef.current = null;
      }
    };
    window.addEventListener("pointerup", handleGlobalUp);
    return () => window.removeEventListener("pointerup", handleGlobalUp);
  }, [isSelecting]);

  useEffect(() => {
    if (isRenaming && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isRenaming]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const data = e.dataTransfer.getData("application/sonicplank/library-item");
    if (data) {
      try {
        const item = JSON.parse(data);
        const rect = e.currentTarget.getBoundingClientRect();
        const xPosition = e.clientX - rect.left;
        onDropItem(track.id, item, xPosition);
      } catch (err) {
        console.error("Failed to parse dropped item", err);
      }
    }
  };

  const formatPan = (val: number) => {
    if (Math.abs(val) < 0.01) return "C";
    if (val < 0) return `L${Math.round(Math.abs(val) * 100)}`;
    return `R${Math.round(val * 100)}`;
  };

  return (
    <div className="flex w-full h-24 border-b border-border bg-card">
      {/* Track Header (Left Sidebar) */}
      <ContextMenu>
        <ContextMenuTrigger className="sticky left-0 z-30 w-64 min-w-[16rem] h-full border-r border-border bg-card p-2.5 flex flex-row gap-2.5 justify-between shrink-0 select-none">
          {/* Main Controls (Flex-1) */}
          <div className="flex flex-col justify-between flex-1 min-w-0 h-full">
            {/* Top row: Track Name & Solo/Mute Buttons */}
            <div className="flex items-center justify-between gap-1 w-full">
              {isRenaming ? (
                <input
                  ref={inputRef}
                  className="font-semibold text-xs w-full bg-background border border-border rounded px-1 outline-none mr-1 py-0.5"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  onBlur={() => {
                    setIsRenaming(false);
                    if (onRenameTrack && editName.trim()) {
                      onRenameTrack(track.id, editName.trim());
                    } else {
                      setEditName(track.name);
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.currentTarget.blur();
                    } else if (e.key === "Escape") {
                      setEditName(track.name);
                      setIsRenaming(false);
                    }
                  }}
                />
              ) : (
                <span className="font-semibold text-xs truncate pr-1">
                  {track.name}
                </span>
              )}
              <div className="flex items-center gap-0.5 shrink-0">
                <Button
                  variant={track.solo ? "default" : "outline"}
                  size="icon"
                  className="h-5 w-5 text-[9px] font-bold"
                  onClick={() => onUpdateTrack?.(track.id, { solo: !track.solo })}
                >
                  S
                </Button>
                <Button
                  variant={track.muted ? "destructive" : "outline"}
                  size="icon"
                  className="h-5 w-5"
                  onClick={() =>
                    onUpdateTrack?.(track.id, { muted: !track.muted })
                  }
                >
                  {track.muted ? (
                    <VolumeX className="h-2.5 w-2.5" />
                  ) : (
                    <Volume2 className="h-2.5 w-2.5" />
                  )}
                </Button>
              </div>
            </div>

            {/* Bottom row: Knobs (Volume & Pan) */}
            <div className="flex items-center justify-between gap-2 mt-1">
              {/* Volume Knob Group */}
              <div className="flex items-center gap-1.5 bg-secondary/15 hover:bg-secondary/25 px-1.5 py-0.5 rounded-sm border border-border/20 transition-all select-none">
                <div className="flex flex-col items-center">
                  <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground leading-none mb-0.5">Vol</span>
                  <Knob
                    className="nodrag nopan nowheel shrink-0"
                    defaultValue={1.0}
                    max={1}
                    min={0}
                    step={0.01}
                    value={track.volume}
                    size="xs"
                    onValueChange={(val) =>
                      onUpdateTrack?.(track.id, { volume: val })
                    }
                  />
                </div>
                <span className="text-[9px] font-mono w-7 text-right font-semibold select-none">
                  {Math.round(track.volume * 100)}%
                </span>
              </div>

              {/* Pan Knob Group */}
              <div className="flex items-center gap-1.5 bg-secondary/15 hover:bg-secondary/25 px-1.5 py-0.5 rounded-sm border border-border/20 transition-all select-none">
                <div className="flex flex-col items-center">
                  <span className="text-[8px] font-bold uppercase tracking-wider text-muted-foreground leading-none mb-0.5">Pan</span>
                  <Knob
                    className="nodrag nopan nowheel shrink-0 text-primary"
                    defaultValue={0}
                    anchor={0}
                    max={1}
                    min={-1}
                    step={0.05}
                    value={track.pan ?? 0}
                    size="xs"
                    onValueChange={(val) =>
                      onUpdateTrack?.(track.id, { pan: val })
                    }
                  />
                </div>
                <span className="text-[9px] font-mono w-7 text-right font-semibold select-none">
                  {formatPan(track.pan ?? 0)}
                </span>
              </div>
            </div>
          </div>

          {/* Level Meter (Right side) */}
          <LevelMeter trackId={track.id} />
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onClick={() => setIsRenaming(true)}>
            <Edit2Icon className="h-4 w-4 mr-2" />
            Rename Track
          </ContextMenuItem>
          <ContextMenuItem
            variant="destructive"
            onClick={() => onRemoveTrack?.(track.id)}
          >
            <Trash2Icon className="h-4 w-4 mr-2" />
            Remove Track
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      <div
        ref={trackBodyRef}
        className="relative flex-1 ml-0.5 h-full overflow-hidden bg-background/50"
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        data-track-id={track.id}
      >
        {/* Selection Overlay */}
        {selection?.trackId === track.id && selection.end > selection.start && (
          <div
            className="absolute top-0 bottom-0 bg-primary/20 border-x border-primary/50 z-30 pointer-events-none group/selection"
            style={{
              left: `${selection.start * pixelsPerSecond}px`,
              width: `${(selection.end - selection.start) * pixelsPerSecond}px`
            }}
          >
            {/* Volume Trim Handle */}
            <div 
              className="absolute top-0 left-0 right-0 h-4 bg-primary/40 opacity-0 group-hover/selection:opacity-100 pointer-events-auto cursor-ns-resize hover:bg-primary/60 transition-all"
              onPointerDown={(e) => {
                e.stopPropagation();
                e.preventDefault();
                
                // Find clip fully encompassing selection
                const clip = track.clips.find(c => c.startTime <= selection.start && c.startTime + c.duration >= selection.end);
                if (!clip) return;

                const initialY = e.clientY;
                const startValue = clip.volume ?? 1.0;
                
                const handleMove = (moveEvent: PointerEvent) => {
                  const deltaY = moveEvent.clientY - initialY;
                  // e.g. 50 pixels = full range 1.0
                  let newValue = startValue - (deltaY / 50);
                  newValue = Math.max(0, Math.min(2.0, newValue));
                  
                  // Inject 4 points for the ducking/boosting envelope
                  const p1 = { time: Math.max(0, selection.start - clip.startTime - 0.01), value: clip.volume ?? 1.0, curve: "smooth" as const };
                  const p2 = { time: selection.start - clip.startTime, value: newValue, curve: "linear" as const };
                  const p3 = { time: selection.end - clip.startTime, value: newValue, curve: "smooth" as const };
                  const p4 = { time: Math.min(clip.duration, selection.end - clip.startTime + 0.01), value: clip.volume ?? 1.0, curve: "smooth" as const };
                  
                  // In a robust implementation, we would merge this with existing envelope points.
                  // For now, replacing the envelope handles the basic trim requirement.
                  onUpdateClip?.(track.id, clip.id, { volumeEnvelope: [p1, p2, p3, p4] });
                };
                
                const handleUp = () => {
                  window.removeEventListener('pointermove', handleMove);
                  window.removeEventListener('pointerup', handleUp);
                };
                
                window.addEventListener('pointermove', handleMove);
                window.addEventListener('pointerup', handleUp);
              }}
            />
          </div>
        )}
        
        {/* Render Clips */}
        {track.clips.map((clip) => (
          <Clip
            key={clip.id}
            clip={clip}
            trackId={track.id}
            pixelsPerSecond={pixelsPerSecond}
            onUpdate={(updates) => onUpdateClip?.(track.id, clip.id, updates)}
            onRemove={() => onRemoveClip?.(track.id, clip.id)}
            onSplit={(time) => onSplitClip?.(track.id, clip.id, time)}
            onMoveTrack={(targetTrackId, newStartTime) =>
              onMoveClipToTrack?.(
                clip.id,
                track.id,
                targetTrackId,
                newStartTime,
              )
            }
          />
        ))}
      </div>
    </div>
  );
}
