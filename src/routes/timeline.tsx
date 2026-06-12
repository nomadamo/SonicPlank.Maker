import { AnimatedRoute } from "@/components/animated-route";
import { LoadingAnimation } from "@/components/animations/loading-animation";
import { createFileRoute } from "@tanstack/react-router";
import { motion, AnimatePresence } from "motion/react";
import {
  PlusIcon,
  PlayIcon,
  SquareIcon,
  PauseIcon,
  LibraryIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
} from "lucide-react";
import { useAtom, useAtomValue } from "jotai";
import {
  timelineTracksAtom,
  timelineDataAtom,
  timelineCurrentTimeAtom,
  timelineIsPlayingAtom,
} from "@/store/timelineStore";
import { useLibraryStore } from "@/store/libraryStore";
import { Track } from "@/components/timeline/Track";
import { Button } from "@/components/ui/button";
import { TimelineClip, TimelineTrack } from "@/types/timeline";
import { useCallback, useState, useEffect, useRef } from "react";
import { useStateMachine } from "@/store/stateMachine";
import { useSettings } from "@/store/settingsStore";
import { useTimelinePlayback } from "@/hooks/useTimelinePlayback";
import { formatTime } from "@/utils/audio";



function RulerPlayhead() {
  const currentTime = useAtomValue(timelineCurrentTimeAtom);
  const { settings } = useSettings();
  const compensationSeconds =
    (settings.playheadLatencyCompensationMs ?? 0) / 1000;
  const displayTime = Math.max(0, currentTime + compensationSeconds);

  return (
    <div
      className="absolute ml-0 cursor-grab top-0 bottom-0 w-[2px] bg-red-500 z-40"
      style={{
        left: `${displayTime * PIXELS_PER_SECOND}px`,
        transform: "translateX(-50%)",
      }}
    >
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-red-500" />
    </div>
  );
}

function TrackPlayhead({
  scrollRef,
}: {
  scrollRef: React.RefObject<HTMLDivElement | null>;
}) {
  const currentTime = useAtomValue(timelineCurrentTimeAtom);
  const { settings } = useSettings();
  const compensationSeconds =
    (settings.playheadLatencyCompensationMs ?? 0) / 1000;
  const displayTime = Math.max(0, currentTime + compensationSeconds);

  // Auto-scroll logic: Keep playhead within the visible screen
  useEffect(() => {
    if (!scrollRef.current) return;

    const container = scrollRef.current;
    const playheadX = displayTime * PIXELS_PER_SECOND;
    const trackHeaderWidth = 256; // 16rem

    // The visual X position of the playhead relative to the scrolling viewport's left edge
    const visualPlayheadX = playheadX - container.scrollLeft;
    const visibleWidth = container.clientWidth - trackHeaderWidth;

    // Define a comfortable viewing window (between 10% and 80% of the screen)
    const leftMargin = visibleWidth * 0.1;
    const rightMargin = visibleWidth * 0.5;

    if (visualPlayheadX > rightMargin) {
      // Playhead is moving past the right margin, push the scroll view
      container.scrollLeft = playheadX - rightMargin;
    } else if (visualPlayheadX < leftMargin && container.scrollLeft > 0) {
      // Playhead is behind the left margin (e.g. from seeking or manual scrolling), bring it into view
      container.scrollLeft = Math.max(0, playheadX - leftMargin);
    }
  }, [displayTime, scrollRef]);

  return (
    <div
      className="absolute top-6 bottom-20.5 -ml-[2px] w-[1px] bg-red-500/50 pointer-events-none z-20"
      style={{ left: `${displayTime * PIXELS_PER_SECOND + 258}px` }}
    />
  );
}

function TimeDisplay({ maxEndTime }: { maxEndTime: number }) {
  const currentTime = useAtomValue(timelineCurrentTimeAtom);
  const { settings } = useSettings();
  const compensationSeconds =
    (settings.playheadLatencyCompensationMs ?? 0) / 1000;
  const displayTime = Math.max(0, currentTime + compensationSeconds);

  return (
    <div className="ml-auto font-mono text-sm tabular-nums text-muted-foreground mr-4 flex items-center bg-background/50 px-3 py-1 rounded border border-border">
      <span className="text-foreground">{formatTime(displayTime)}</span>
      <span className="mx-1 opacity-50">/</span>
      <span className="opacity-70">{formatTime(maxEndTime)}</span>
    </div>
  );
}

export const Route = createFileRoute("/timeline")({
  beforeLoad: () => {
    console.log("Timeline page");
  },
  component: Timeline,
  pendingComponent: LoadingAnimation,
});

const PIXELS_PER_SECOND = 50;

function Timeline() {
  const [tracks, setTracks] = useAtom(timelineTracksAtom);
  const [timelineData] = useAtom(timelineDataAtom);
  const { categories, items: libraryItems } = useLibraryStore();
  const displayLibraryItems = libraryItems.filter((item) => !item.isStream);
  const { setHasUnsavedChanges } = useStateMachine();
  const { isPlaying, play, pause, togglePlay, seek } = useTimelinePlayback();
  const scrollRef = useRef<HTMLDivElement>(null);

  const { settings, updateSettings } = useSettings();
  const [sidebarWidth, setSidebarWidth] = useState(
    settings.timelineSidebarWidth ?? 256,
  );
  const currentWidthRef = useRef(sidebarWidth);
  const ghostLineRef = useRef<HTMLDivElement>(null);

  // Sync state if settings change externally
  useEffect(() => {
    if (settings.timelineSidebarWidth !== undefined) {
      setSidebarWidth(settings.timelineSidebarWidth);
      currentWidthRef.current = settings.timelineSidebarWidth;
    }
  }, [settings.timelineSidebarWidth]);

  const isSidebarOpen = settings.timelineSidebarOpen ?? true;
  const setIsSidebarOpen = useCallback(
    (open: boolean) => {
      updateSettings({ timelineSidebarOpen: open });
    },
    [updateSettings],
  );

  const isResizing = useRef(false);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isResizing.current) return;
      let newWidth = e.clientX;
      if (newWidth < 150) newWidth = 150;
      if (newWidth > 256) newWidth = 256;
      if (ghostLineRef.current) {
        ghostLineRef.current.style.transform = `translateX(${newWidth}px)`;
        ghostLineRef.current.style.display = "block";
      }
      currentWidthRef.current = newWidth;
    },
    [],
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (isResizing.current) {
        isResizing.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        if (ghostLineRef.current) {
          ghostLineRef.current.style.display = "none";
        }
        setSidebarWidth(currentWidthRef.current);
        updateSettings({ timelineSidebarWidth: currentWidthRef.current });
      }
    },
    [updateSettings],
  );

  const startResizing = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const maxEndTime = tracks.reduce((max, track) => {
    const trackMax = track.clips.reduce(
      (tMax, clip) => Math.max(tMax, clip.startTime + clip.duration),
      0,
    );
    return Math.max(max, trackMax ?? 20);
  }, 0);

  // Constrain timeline width exactly to maxEndTime, ensuring it at least fills the visible window initially
  const minScreenWidth =
    typeof window !== "undefined" ? window.innerWidth - 256 : 1000;
  const timelineWidthPx = Math.max(
    maxEndTime * PIXELS_PER_SECOND,
    minScreenWidth,
  );

  // Save timeline on changes
  useEffect(() => {
    window.electron.saveTimeline(timelineData).catch((err) => {
      console.error("Failed to save timeline", err);
    });
  }, [timelineData]);

  const handleAddTrack = () => {
    setTracks((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        name: `Track ${prev.length + 1}`,
        muted: false,
        solo: false,
        volume: 1,
        pan: 0,
        clips: [],
      },
    ]);
    setHasUnsavedChanges(true);
  };

  const handleDropItem = useCallback(
    (trackId: string, item: any, xPosition: number) => {
      if (item.isStream) return;

      // Calculate start time based on drop X coordinate
      const startTime = Math.max(0, xPosition / PIXELS_PER_SECOND);
      const duration = item.duration || 10; // Fallback to 10s if duration missing

      const newClip: TimelineClip = {
        id: crypto.randomUUID(),
        item,
        startTime,
        startOffset: 0,
        duration,
      };

      setTracks((prev) =>
        prev.map((track) => {
          if (track.id === trackId) {
            return {
              ...track,
              clips: [...track.clips, newClip],
            };
          }
          return track;
        }),
      );
      setHasUnsavedChanges(true);
    },
    [setTracks, setHasUnsavedChanges],
  );

  const handleRemoveTrack = useCallback(
    (trackId: string) => {
      setTracks((prev) => prev.filter((t) => t.id !== trackId));
      setHasUnsavedChanges(true);
    },
    [setTracks, setHasUnsavedChanges],
  );

  const handleRenameTrack = useCallback(
    (trackId: string, newName: string) => {
      setTracks((prev) =>
        prev.map((track) =>
          track.id === trackId ? { ...track, name: newName } : track,
        ),
      );
      setHasUnsavedChanges(true);
    },
    [setTracks, setHasUnsavedChanges],
  );

  const handleUpdateTrack = useCallback(
    (trackId: string, updates: Partial<TimelineTrack>) => {
      setTracks((prev) =>
        prev.map((track) =>
          track.id === trackId ? { ...track, ...updates } : track,
        ),
      );
      setHasUnsavedChanges(true);
    },
    [setTracks, setHasUnsavedChanges],
  );

  const handleUpdateClip = useCallback(
    (trackId: string, clipId: string, updates: Partial<TimelineClip>) => {
      setTracks((prev) =>
        prev.map((track) => {
          if (track.id !== trackId) return track;
          return {
            ...track,
            clips: track.clips.map((clip) =>
              clip.id === clipId ? { ...clip, ...updates } : clip,
            ),
          };
        }),
      );
      setHasUnsavedChanges(true);
    },
    [setTracks, setHasUnsavedChanges],
  );

  const handleRemoveClip = useCallback(
    (trackId: string, clipId: string) => {
      setTracks((prev) =>
        prev.map((track) => {
          if (track.id !== trackId) return track;
          return {
            ...track,
            clips: track.clips.filter((clip) => clip.id !== clipId),
          };
        }),
      );
      setHasUnsavedChanges(true);
    },
    [setTracks, setHasUnsavedChanges],
  );

  const handleMoveClipToTrack = useCallback(
    (
      clipId: string,
      sourceTrackId: string,
      targetTrackId: string,
      newStartTime: number,
    ) => {
      setTracks((prev) => {
        let clipToMove: TimelineClip | undefined;

        // Find and remove from source track
        const tracksWithoutClip = prev.map((track) => {
          if (track.id === sourceTrackId) {
            const clip = track.clips.find((c) => c.id === clipId);
            if (clip) clipToMove = { ...clip, startTime: newStartTime };
            return {
              ...track,
              clips: track.clips.filter((c) => c.id !== clipId),
            };
          }
          return track;
        });

        // If clip found, add to target track
        if (clipToMove) {
          return tracksWithoutClip.map((track) => {
            if (track.id === targetTrackId) {
              return {
                ...track,
                clips: [...track.clips, clipToMove!],
              };
            }
            return track;
          });
        }

        return prev;
      });
      setHasUnsavedChanges(true);
    },
    [setTracks, setHasUnsavedChanges],
  );

  return (
    <AnimatedRoute variant="fade">
      <div className="flex h-[calc(100vh-60px)] w-full overflow-hidden relative">
        {/* Ghost Line for resizing */}
        <div
          ref={ghostLineRef}
          className="absolute top-0 bottom-0 w-1 bg-primary/50 z-[100] pointer-events-none"
          style={{ display: "none", left: 0 }}
        />
        {/* Left Side: Mini Library Panel */}
        <div
          className="border-r border-border bg-card/50 flex flex-col relative shrink-0"
          style={{ width: isSidebarOpen ? `${sidebarWidth}px` : "48px" }}
        >
          <div className="p-2 border-b flex items-center justify-between border-border bg-muted/20 font-medium text-sm min-h-[37px]">
            {isSidebarOpen ? (
              <>
                <div className="flex gap-2 items-center flex-row">
                  <LibraryIcon className="ps-1" size="20px" />
                  Library
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setIsSidebarOpen(false)}
                  className="h-6 w-6 shrink-0"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSidebarOpen(true)}
                className="h-6 w-6 shrink-0 mx-auto"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
            )}
          </div>
          {isSidebarOpen && (
            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {displayLibraryItems.length === 0 ? (
                <p className="text-xs text-muted-foreground p-2">
                  Library is empty
                </p>
              ) : (
                displayLibraryItems.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      objectFit: "contain",
                      backgroundImage: `${item.albumArt ? `url(${item.albumArt})` : ""}`,
                      backgroundBlendMode: "overlay",
                    }}
                    className="border border-border rounded bg-background/70"
                  >
                    <div
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          "application/sonicplank/library-item",
                          JSON.stringify(item),
                        );
                        e.dataTransfer.effectAllowed = "copy";
                      }}
                      className="p-2 rounded shadow-sm text-xs cursor-grab active:cursor-grabbing hover:bg-indigo-400/30"
                      title={item.title}
                    >
                      <div className="font-medium truncate">{item.title}</div>
                      <div className="text-muted-foreground truncate opacity-80">
                        {item.artist}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Resize Handle */}
          {isSidebarOpen && (
            <div
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-primary/50 active:bg-primary/50 z-10"
              onPointerDown={startResizing}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          )}
        </div>

        {/* Main Canvas: Timeline */}
        <div className="flex-1 flex flex-col bg-background overflow-hidden relative">
          {/* Timeline Header (Transport / Tools) */}
          {tracks.length > 0 && (
            <div className="h-12 border-b border-border bg-card flex items-center px-4 gap-2 z-20">
              <Button
                variant={isPlaying ? "secondary" : "outline"}
                size="icon"
                className="h-8 w-8"
                onClick={togglePlay}
              >
                {isPlaying ? (
                  <PauseIcon className="h-4 w-4" />
                ) : (
                  <PlayIcon className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  pause();
                  seek(0);
                }}
              >
                <SquareIcon className="h-4 w-4" />
              </Button>
              <div className="w-px h-6 bg-border mx-2" />
              <Button
                variant="secondary"
                size="sm"
                onClick={handleAddTrack}
                className="gap-2"
              >
                <PlusIcon className="h-4 w-4" /> Add Track
              </Button>
              <TimeDisplay maxEndTime={maxEndTime} />
            </div>
          )}

          {/* Tracks Area */}
          {tracks.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-muted-foreground bg-muted/10">
              <p>No tracks added yet.</p>
              <Button
                variant="outline"
                onClick={handleAddTrack}
                className="mt-4 gap-2"
              >
                <PlusIcon className="h-4 w-4" /> Add Track
              </Button>
            </div>
          ) : (
            <div className="flex-1 overflow-auto bg-muted/10" ref={scrollRef}>
              <div className="min-w-max pb-20 relative">
                <div className="flex sticky top-0 z-40 w-fit">
                  {/* Sticky Top-Left Corner Spacer */}
                  <div className="w-64 min-w-[16rem] shrink-0 h-6 bg-card border-b border-r border-border sticky left-0 z-50" />
                  {/* Ruler */}
                  <div
                    className="h-6 border-b border-border bg-card/80 flex overflow-hidden cursor-text relative"
                    style={{ width: `${timelineWidthPx}px` }}
                    onMouseDown={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      const x = e.clientX - rect.left;
                      const visualTime = x / PIXELS_PER_SECOND;
                      const compensationSeconds =
                        (settings.playheadLatencyCompensationMs ?? 0) / 1000;
                      seek(Math.max(0, visualTime - compensationSeconds));
                    }}
                  >
                    {Array.from({
                      length: Math.ceil(timelineWidthPx / PIXELS_PER_SECOND),
                    }).map((_, i) => (
                      <div
                        key={i}
                        className={`absolute bottom-0 border-l ${i % 5 === 0 ? "border-border/80 h-full" : "border-border/40 h-1/2"} flex items-end pl-1 pointer-events-none`}
                        style={{ left: `${i * PIXELS_PER_SECOND}px` }}
                      >
                        {i % 5 === 0 && (
                          <span className="text-[10px] text-muted-foreground leading-none mb-[2px]">
                            {formatTime(i)}
                          </span>
                        )}
                      </div>
                    ))}
                    {/* Playhead on Ruler */}
                    <RulerPlayhead />
                  </div>
                </div>

                {/* Playhead Line in Tracks */}
                <TrackPlayhead scrollRef={scrollRef} />

                <AnimatePresence>
                  {tracks.map((track) => (
                    <motion.div
                      key={track.id}
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 96 }}
                      exit={{ opacity: 0, height: 0 }}
                    >
                      <Track
                        track={track}
                        pixelsPerSecond={PIXELS_PER_SECOND}
                        onDropItem={handleDropItem}
                        onRemoveTrack={handleRemoveTrack}
                        onRenameTrack={handleRenameTrack}
                        onUpdateTrack={handleUpdateTrack}
                        onUpdateClip={handleUpdateClip}
                        onRemoveClip={handleRemoveClip}
                        onMoveClipToTrack={handleMoveClipToTrack}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>
      </div>
    </AnimatedRoute>
  );
}
