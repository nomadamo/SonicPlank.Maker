import { TimelineClip } from "@/types/timeline";
import { cn } from "@/lib/utils";
import {
  useState,
  useRef,
  useEffect,
  MouseEvent as ReactMouseEvent,
} from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Trash2Icon } from "lucide-react";

import { StaticWaveform } from "@/components/ui/staticwaveform";

interface ClipProps {
  clip: TimelineClip;
  trackId: string;
  pixelsPerSecond: number;
  onUpdate?: (updates: Partial<TimelineClip>) => void;
  onRemove?: () => void;
  onMoveTrack?: (targetTrackId: string, newStartTime: number) => void;
}

export function Clip({
  clip,
  trackId,
  pixelsPerSecond,
  onUpdate,
  onRemove,
  onMoveTrack,
}: ClipProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [dragType, setDragType] = useState<
    "move" | "resize-left" | "resize-right" | null
  >(null);

  // Local state for smooth drag updates without hitting Jotai continuously
  const [localStartTime, setLocalStartTime] = useState(clip.startTime);
  const [localDuration, setLocalDuration] = useState(clip.duration);
  const [localStartOffset, setLocalStartOffset] = useState(clip.startOffset);

  const initialDragState = useRef({
    startX: 0,
    startTime: 0,
    duration: 0,
    startOffset: 0,
  });

  // Sync local state when clip prop changes (if not dragging)
  useEffect(() => {
    if (!isDragging) {
      setLocalStartTime(clip.startTime);
      setLocalDuration(clip.duration);
      setLocalStartOffset(clip.startOffset || 0);
    }
  }, [clip, isDragging]);

  useEffect(() => {
    if (!clip.item.duration && clip.duration === 10) {
      const audio = new Audio("file:///" + clip.item.filePath);
      const handleLoadedMetadata = () => {
        if (audio.duration && audio.duration !== 10) {
          onUpdate?.({ duration: audio.duration });
        }
      };
      audio.addEventListener("loadedmetadata", handleLoadedMetadata);
      return () => {
        audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      };
    }
  }, [clip.item.duration, clip.duration, clip.item.filePath, onUpdate]);

  const handleMouseDown = (
    e: ReactMouseEvent,
    type: "move" | "resize-left" | "resize-right",
  ) => {
    e.stopPropagation();
    setIsDragging(true);
    setDragType(type);
    initialDragState.current = {
      startX: e.clientX,
      startTime: localStartTime,
      duration: localDuration,
      startOffset: localStartOffset,
    };
  };

  useEffect(() => {
    if (!isDragging || !dragType) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - initialDragState.current.startX;
      const deltaSeconds = deltaX / pixelsPerSecond;

      if (dragType === "move") {
        const newStartTime = Math.max(
          0,
          initialDragState.current.startTime + deltaSeconds,
        );
        setLocalStartTime(newStartTime);
      } else if (dragType === "resize-right") {
        // Minimum duration of 0.1s
        const newDuration = Math.max(
          0.1,
          initialDragState.current.duration + deltaSeconds,
        );
        setLocalDuration(newDuration);
      } else if (dragType === "resize-left") {
        // Trimming from the left means startTime increases, startOffset increases, duration decreases
        // We constrain it so duration doesn't go below 0.1s
        const maxDelta = initialDragState.current.duration - 0.1;
        // Also don't push startTime below 0
        const minDelta = -initialDragState.current.startTime;

        const clampedDelta = Math.max(
          minDelta,
          Math.min(maxDelta, deltaSeconds),
        );

        setLocalStartTime(initialDragState.current.startTime + clampedDelta);
        setLocalStartOffset(
          Math.max(0, initialDragState.current.startOffset + clampedDelta),
        );
        setLocalDuration(initialDragState.current.duration - clampedDelta);
      }
    };

    const handleMouseUp = (e: MouseEvent) => {
      setIsDragging(false);
      setDragType(null);

      if (dragType === "move" && onMoveTrack) {
        // Check if dropped on a different track
        // Temporarily disable pointer-events on this clip to find the track underneath
        const clipEl = document.getElementById(`clip-${clip.id}`);
        if (clipEl) clipEl.style.pointerEvents = "none";

        const elementUnderCursor = document.elementFromPoint(
          e.clientX,
          e.clientY,
        );
        const trackElement = elementUnderCursor?.closest("[data-track-id]");

        if (clipEl) clipEl.style.pointerEvents = "auto";

        if (trackElement) {
          const targetTrackId = trackElement.getAttribute("data-track-id");
          if (targetTrackId && targetTrackId !== trackId) {
            // Move to new track! We don't call onUpdate, we call onMoveTrack
            onMoveTrack(targetTrackId, localStartTime);
            return;
          }
        }
      }
    };

    document.addEventListener("mousemove", handleMouseMove, { passive: true });
    document.addEventListener("mouseup", handleMouseUp, { passive: true });

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging, dragType, pixelsPerSecond, onUpdate]);

  // To fix the closure issue, we can commit the state by syncing ref in render
  const latestState = useRef({
    localStartTime,
    localDuration,
    localStartOffset,
  });
  latestState.current = { localStartTime, localDuration, localStartOffset };

  useEffect(() => {
    if (!isDragging && dragType === null) {
      // Just stopped dragging, check if different from clip
      const state = latestState.current;
      if (
        state.localStartTime !== clip.startTime ||
        state.localDuration !== clip.duration ||
        state.localStartOffset !== clip.startOffset
      ) {
        onUpdate?.({
          startTime: state.localStartTime,
          duration: state.localDuration,
          startOffset: state.localStartOffset,
        });
      }
    }
  }, [isDragging, dragType]); // only run when isDragging changes

  const left = localStartTime * pixelsPerSecond;
  const width = localDuration * pixelsPerSecond;
  const audioDuration = clip.item.duration || localDuration;
  const wsWidth = audioDuration * pixelsPerSecond;
  const wsTransform = `translateX(-${localStartOffset * pixelsPerSecond}px)`;

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          id={`clip-${clip.id}`}
          className={cn(
            "absolute top-0.5 bottom-0.5 rounded-md overflow-hidden border shadow-sm group",
            "bg-primary/10 border-primary/40 hover:bg-primary/20 hover:border-primary/60 transition-colors duration-150",
            isDragging ? "opacity-80 z-20" : "z-10",
          )}
          style={{ left: `${left}px`, width: `${width}px` }}
          title={clip.item.title}
        >
          {/* Drag Handle (Title Bar) */}
          <div
            className={cn(
              "absolute top-0 inset-x-0 h-5 bg-background/40 hover:bg-background/60 backdrop-blur-sm z-30 flex items-center px-2",
              isDragging ? "cursor-grabbing" : "cursor-grab",
            )}
            onMouseDown={(e) => handleMouseDown(e, "move")}
          >
            <span className="text-[10px] font-medium text-foreground truncate select-none pointer-events-none">
              {clip.item.title}
            </span>
          </div>

          {/* Waveform Container */}
          <div className="absolute inset-0 mt-2 overflow-hidden">
            <div
              className="absolute top-0 bottom-0 h-full flex flex-col"
              style={{
                width: `${wsWidth}px`,
                transform: wsTransform,
                transformOrigin: "left",
              }}
            >
              <StaticWaveform
                className="flex-1 opacity-60 pointer-events-none"
                audioUrl={clip.item.filePath}
                barColor="oklch(0.70 0.01 286.07)"
                height={70}
                pixelsPerSecond={pixelsPerSecond}
              />
            </div>
          </div>

          {/* Left Resize Handle */}
          <div
            className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-foreground/20 z-40"
            onMouseDown={(e) => handleMouseDown(e, "resize-left")}
          />

          {/* Right Resize Handle */}
          <div
            className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-foreground/20 z-40"
            onMouseDown={(e) => handleMouseDown(e, "resize-right")}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem variant="destructive" onClick={() => onRemove?.()}>
          <Trash2Icon className="h-4 w-4 mr-2" />
          Remove Clip
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
