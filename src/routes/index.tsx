import { cn } from "@/lib/utils";
import { AnimatedRoute } from "@/components/animated-route";
import { LoadingAnimation } from "@/components/animations/loading-animation";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { motion, AnimatePresence } from "motion/react";
import { useCallback, useEffect, useState, useRef, useMemo } from "react";
import {
  MusicIcon,
  PlusIcon,
  Trash2Icon,
  WorkflowIcon,
  ListMusicIcon,
  Settings2Icon,
  PlayCircleIcon,
  SquareIcon,
  TagsIcon,
  ActivityIcon,
  Filter,
  Mic,
  Radio,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAtom } from "jotai";
import { flowNodesAtom } from "@/store/flowStore";
import { timelineTracksAtom } from "@/store/timelineStore";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { LibraryItem, LibraryData } from "@/types/library-item";
import { useStateMachine } from "@/store/stateMachine";
import { useLibraryStore } from "@/store/libraryStore";
import { LibraryItemPropertiesDialog } from "@/components/library-item-properties-dialog";
import {
  AudioPlayer,
  AudioPlayerControlBar,
  AudioPlayerControlGroup,
  AudioPlayerPlay,
  AudioPlayerSeekBar,
  AudioPlayerTimeDisplay,
  AudioPlayerVolume,
} from "@/components/audio/player";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import { Combobox as ComboboxPrimitive } from "@base-ui/react";
import { useAudioStore } from "@/lib/audio-store";
import { useAudio } from "@/hooks/use-audio";
import { Mixed8 } from "waviz";
import { CategoryManagerDialog } from "@/components/category-manager-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { ClockIcon } from "@fluentui/react-icons-mdl2";
import { IconName } from "lucide-react/dynamic";
import { Icon } from "@/components/ui/icon-picker";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { RecordingDialog } from "@/components/recording-dialog";
import { AddStreamDialog } from "@/components/add-stream-dialog";
import { AddAudioDialog } from "@/components/add-audio-dialog";
import { useSettings } from "@/store/settingsStore";
import {
  isSupportedAudioFile,
  formatTime as formatDuration,
  extractStreamInfo,
} from "@/utils/audio";
import { IconBrandSpotify } from "@tabler/icons-react";

export const Route = createFileRoute("/")({
  beforeLoad: () => {
    console.log("Library page");
  },
  component: Library,
  pendingComponent: LoadingAnimation,
});

function VisualizerBackdrop({ visible }: { visible: boolean }) {
  const { htmlAudio, webAudio } = useAudio();
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  // We wrap the audioEl and canvasEl in stable ref-like objects so Mixed8 can read from them.
  // We use useMemo so we aren't creating new objects every render, nor mutating useRef objects during rendering/effects.
  const audioRef = useMemo(() => ({ current: audioEl }), [audioEl]);
  const canvasRef = useMemo(() => ({ current: canvasEl }), [canvasEl]);

  useEffect(() => {
    if (visible) {
      setAudioEl(htmlAudio.getAudioElement());
    } else {
      setAudioEl(null);
    }
  }, [visible, htmlAudio]);

  const [dimensions, setDimensions] = useState({ width: 1000, height: 80 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      if (entries[0]) {
        setDimensions({
          width: entries[0].contentRect.width,
          height: entries[0].contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={cn(
        "absolute inset-0 z-0 pointer-events-none overflow-hidden transition-opacity duration-500",
        visible ? "opacity-20" : "opacity-0",
      )}
    >
      <canvas
        ref={setCanvasEl}
        width={dimensions.width}
        height={dimensions.height}
        className="w-full h-full object-cover"
      />
      {canvasEl && (
        <Mixed8
          srcAudio={audioRef}
          srcCanvas={canvasRef}
          audioContext={webAudio.getContext() ?? undefined}
        />
      )}
    </div>
  );
}

function LibraryAudioPlayerWrapper({
  item,
  onStop,
  showVisualizer,
  onToggleVisualizer,
}: {
  item: LibraryItem;
  onStop: () => void;
  showVisualizer: boolean;
  onToggleVisualizer: () => void;
}) {
  const setCurrentTrack = useAudioStore((s) => s.setCurrentTrack);
  const pause = useAudioStore((s) => s.pause);

  const track = {
    id: item.id,
    url:
      item.filePath.startsWith("http://") ||
      item.filePath.startsWith("https://")
        ? item.filePath
        : item.filePath.startsWith("file:///")
          ? item.filePath
          : "file:///" + item.filePath,
    title: item.title,
    artist: item.artist,
    duration: item.duration,
  };

  const { htmlAudio } = useAudio();

  useEffect(() => {
    const audio = htmlAudio.getAudioElement();
    if (!audio) return;

    const handleEnded = () => {
      onStop();
    };

    audio.addEventListener("ended", handleEnded);
    return () => {
      audio.removeEventListener("ended", handleEnded);
    };
  }, [htmlAudio, onStop]);

  useEffect(() => {
    // Autoplay the track on mount by setting it as current.
    const timer = setTimeout(() => {
      setCurrentTrack(track);
    }, 50);

    return () => {
      clearTimeout(timer);
      pause();
      setCurrentTrack(null);
    };
  }, [item.id, setCurrentTrack, pause]);

  return (
    <AudioPlayer
      tracks={[]}
      size="sm"
      className="w-full shadow-none border-none bg-transparent rounded-none"
      style={{ background: "transparent", border: "none", boxShadow: "none" }}
    >
      <AudioPlayerControlBar
        variant="compact"
        className="px-4 py-2 w-full flex items-center justify-between"
      >
        {/* Left: Title & Artist */}
        <div className="flex flex-col gap-0.5 p-3 items-start justify-center w-1/4 min-w-[120px] overflow-hidden">
          <div
            className="font-bold text-shadow-black text-foreground truncate w-full"
            title={item.title}
          >
            {item.title}
          </div>
          <div
            className="text-muted-foreground text-shadow-black truncate w-full"
            title={item.artist}
          >
            {item.artist}
          </div>
        </div>

        {/* Center: Controls & Seek */}
        <div className="flex flex-col items-center justify-center gap-1 flex-1 max-w-2xl px-4">
          <div className="flex items-center ml-13.5 gap-4">
            <AudioPlayerPlay
              className="h-17 w-17 m-0! p-0! [&_svg]:h-6 bg-secondary border [&_svg]:w-6 rounded-full"
              size="icon-lg"
              variant="ghost"
            />
            <Button
              variant="ghost"
              size="lg"
              style={{
                width: "40px",
                height: "40px",
              }}
              onClick={onStop}
              className="text-muted-foreground hover:text-foreground"
              title="Stop"
            >
              <SquareIcon className="h-4 w-4 fill-current" />
            </Button>
          </div>
          <div className="flex items-center gap-2 w-full">
            <AudioPlayerTimeDisplay className="text-xs" />
            <AudioPlayerSeekBar />
            <AudioPlayerTimeDisplay remaining className="text-xs" />
          </div>
        </div>

        {/* Right: Volume */}
        <div className="flex items-center justify-end w-1/4 min-w-[150px] gap-2">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onToggleVisualizer}
                  className={cn(
                    "text-muted-foreground hover:text-foreground shrink-0 rounded-full h-8 w-8",
                    showVisualizer && "text-primary mix-blend-soft-light",
                  )}
                >
                  <ActivityIcon className="h-4 w-4" />
                </Button>
              }
            />
            <TooltipContent>
              Toggle Visiualizer {showVisualizer ? "off" : "on"}
            </TooltipContent>
          </Tooltip>
          <AudioPlayerVolume />
        </div>
      </AudioPlayerControlBar>
    </AudioPlayer>
  );
}

function Library() {
  const [addAudioQueue, setAddAudioQueue] = useState<string[]>([]);
  const [addAudioOpen, setAddAudioOpen] = useState(false);
  const [prefilledStreamTitle, setPrefilledStreamTitle] = useState("");
  const [prefilledStreamUrl, setPrefilledStreamUrl] = useState("");
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [showVisualizer, setShowVisualizer] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playingItemId, setPlayingItemId] = useState<string | null>(null);
  const [propertiesItem, setPropertiesItem] = useState<LibraryItem | null>(
    null,
  );
  const [managerOpen, setManagerOpen] = useState(false);
  const [recordingOpen, setRecordingOpen] = useState(false);
  const [addStreamOpen, setAddStreamOpen] = useState(false);
  const { setHasUnsavedChanges, loaded } = useStateMachine();
  const [flowNodesData, setFlowNodesData] = useAtom(flowNodesAtom);
  const [timelineTracks, setTimelineTracks] = useAtom(timelineTracksAtom);
  const { items, setItems, categories } = useLibraryStore();
  const [categoryFilter, setCategoryFilter] = useState("none");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const anchor = useRef<HTMLButtonElement>(null);
  const navigate = useNavigate();
  const { settings } = useSettings();

  const filteredItems = useMemo(() => {
    if (selectedCategories.length === 0) return items;
    return items.filter(
      (item) => item.categoryId && selectedCategories.includes(item.categoryId),
    );
  }, [items, selectedCategories]);

  // Save library whenever items or categories change, but only after initial load
  // to avoid overwriting persisted data with empty state during early mount.
  useEffect(() => {
    if (!loaded) return;
    const data: LibraryData = { items, categories };
    window.electron.saveLibrary(data).catch((error) => {
      console.error("[Library] Failed to save library:", error);
    });
  }, [loaded, items, categories, categoryFilter, selectedCategories]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDraggingOver(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        const audioPaths: string[] = [];
        let streamInfo: { url: string; title: string } | null = null;

        for (const file of files) {
          const parsedStream = await extractStreamInfo(file);
          if (parsedStream) {
            streamInfo = parsedStream;
            continue;
          }

          try {
            const path = window.electron.getFilePath(file);
            if (path) {
              audioPaths.push(path);
            }
          } catch (err) {
            console.error("[Library DragDrop] Failed to get file path:", err);
          }
        }

        if (streamInfo) {
          setPrefilledStreamTitle(streamInfo.title);
          setPrefilledStreamUrl(streamInfo.url);
          setAddStreamOpen(true);
        }

        if (audioPaths.length > 0) {
          const validPaths = audioPaths.filter((filePath) => {
            const fileName = filePath.split(/[\\/]/).pop() || filePath;
            if (!isSupportedAudioFile(fileName)) return false;
            if (items.some((item) => item.filePath === filePath)) return false;
            return true;
          });

          if (validPaths.length > 0) {
            setAddAudioQueue((prev) => [...prev, ...validPaths]);
            setAddAudioOpen(true);
          }
        }
      }
    },
    [items],
  );

  const handleSaveAudioItem = useCallback(
    (item: LibraryItem) => {
      setItems((prev) => [...prev, item]);
      setAddAudioQueue((prevQueue) => {
        const nextQueue = prevQueue.slice(1);
        if (nextQueue.length > 0) {
          setAddAudioOpen(true);
        } else {
          setAddAudioOpen(false);
        }
        return nextQueue;
      });
    },
    [setItems],
  );

  const handleAddAudioOpenChange = useCallback((open: boolean) => {
    setAddAudioOpen(open);
    if (!open) {
      setAddAudioQueue([]);
    }
  }, []);

  const handleAddFiles = useCallback(async () => {
    try {
      const filePaths = await window.electron.openFileDialog();
      if (filePaths.length > 0) {
        const validPaths = filePaths.filter((filePath) => {
          const fileName = filePath.split(/[\\/]/).pop() || filePath;
          if (!isSupportedAudioFile(fileName)) return false;
          if (items.some((item) => item.filePath === filePath)) return false;
          return true;
        });

        if (validPaths.length > 0) {
          setAddAudioQueue(validPaths);
          setAddAudioOpen(true);
        }
      }
    } catch (error) {
      console.error("[Library] File dialog error:", error);
    }
  }, [items]);

  const handleAddSpotify = useCallback(() => {
    return null;
  }, []);

  const handleStopPlaying = useCallback(() => setPlayingItemId(null), []);

  const handleRemoveItem = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const handleAddToFlow = useCallback(
    (item: LibraryItem) => {
      const nodeCount = flowNodesData?.length || 0;
      const offset = nodeCount * 30 + 30;
      const newNode = {
        id: crypto.randomUUID(),
        type: "audioFlowNode" as const,
        position: { x: 120 + offset, y: 120 + offset },
        data: {
          title: item.title,
          artist: item.artist,
          mediaPath: item.filePath,
          volume: 1,
        },
      };
      setFlowNodesData((prev) => [...(prev || []), newNode]);
      setHasUnsavedChanges(true);
      void navigate({ to: "/flow-editor" });
    },
    [flowNodesData, setFlowNodesData, setHasUnsavedChanges, navigate],
  );

  const handleSetCategoryFilter = useCallback(
    (item: string) => {
      setCategoryFilter(item);
    },
    [setCategoryFilter],
  );

  const handleAddToTimeline = useCallback(
    (item: LibraryItem) => {
      setTimelineTracks((prev) => {
        const tracks = [...prev];
        if (tracks.length === 0) {
          tracks.push({
            id: crypto.randomUUID(),
            name: "Track 1",
            muted: false,
            solo: false,
            volume: 1,
            pan: 0,
            clips: [],
          });
        }

        // Add to the end of the first track
        const firstTrack = tracks[0];
        const lastClipEnd = firstTrack.clips.reduce(
          (max, clip) => Math.max(max, clip.startTime + clip.duration),
          0,
        );

        const newClip = {
          id: crypto.randomUUID(),
          item,
          startTime: lastClipEnd,
          startOffset: 0,
          duration: item.duration || 10,
        };

        firstTrack.clips = [...firstTrack.clips, newClip];
        return tracks;
      });
      setHasUnsavedChanges(true);
      void navigate({ to: "/sonics" });
    },
    [setTimelineTracks, setHasUnsavedChanges, navigate],
  );

  const isEmpty = items.length === 0;

  return (
    <AnimatedRoute variant="fade">
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          height: "calc(100vh - 125px)",
          position: "relative",
        }}
        className="mt-13"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={void handleDrop}
      >
        {isDraggingOver && (
          <div className="absolute inset-0 bg-primary/10 border-2 border-dashed border-primary rounded-xl flex flex-col items-center justify-center gap-3 backdrop-blur-[2px] z-[60] pointer-events-none transition-all">
            <PlusIcon className="h-10 w-10 text-primary animate-bounce" />
            <p className="text-sm font-semibold text-primary">
              Drop audio files here to add to Library
            </p>
          </div>
        )}
        {isEmpty ? (
          /* Empty State */
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15, duration: 0.3 }}
            className="flex flex-col items-center gap-4"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flex: 1,
              gap: "16px",
            }}
          >
            <MusicIcon
              className="text-muted-foreground"
              size={56}
              strokeWidth={1}
              style={{ opacity: 0.5 }}
            />
            <h2 className="text-xl font-medium text-muted-foreground">
              Your library is empty
            </h2>
            <p className="text-sm text-muted-foreground/70 max-w-sm text-center">
              Add audio files to get started.
            </p>
            <div className="flex items-center gap-4 mt-2">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline" className="gap-2" size="lg">
                      <PlusIcon className="h-4 w-4" />
                      Add Audio
                    </Button>
                  }
                />
                <DropdownMenuContent align="center" side="bottom">
                  <DropdownMenuItem
                    onClick={handleAddFiles}
                    className="cursor-pointer"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add Audio Files
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setPrefilledStreamTitle("");
                      setPrefilledStreamUrl("");
                      setAddStreamOpen(true);
                    }}
                    className="cursor-pointer"
                  >
                    <Radio className="h-4 w-4" />
                    Add Stream
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setRecordingOpen(true)}
                    className="cursor-pointer"
                  >
                    <Mic className="h-4 w-4" />
                    Record Audio
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleAddSpotify}
                    className="cursor-pointer"
                  >
                    <IconBrandSpotify className="h-4 w-4" />
                    Add from Spotify
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                onClick={() => setManagerOpen(true)}
                className="gap-2"
                size="lg"
              >
                <TagsIcon className="h-4 w-4" />
                Manage Categories
              </Button>
            </div>
          </motion.div>
        ) : (
          /* Populated State */
          <>
            <div
              className={cn(
                "flex-1 overflow-y-auto w-full h-full p-4 transition-all duration-300",
                playingItemId ? "pb-[160px]" : "pb-24",
              )}
            >
              {/* Category Filter Combobox Row */}
              <div className="flex items-center justify-between mb-4 w-full px-1">
                <div className="flex items-center gap-2">
                  <Combobox
                    multiple
                    value={selectedCategories}
                    onValueChange={setSelectedCategories}
                    items={categories.map((c) => c.id)}
                  >
                    <ComboboxPrimitive.Trigger
                      ref={anchor}
                      render={
                        <Button
                          variant={
                            selectedCategories.length > 0
                              ? "default"
                              : "outline"
                          }
                          size="icon"
                          className="h-10 w-10 rounded-xl transition-all"
                        />
                      }
                    >
                      <Filter
                        className={cn(
                          "h-4 w-4",
                          selectedCategories.length > 0 &&
                            "text-primary-foreground",
                        )}
                      />
                    </ComboboxPrimitive.Trigger>

                    <ComboboxContent anchor={anchor} className="w-56">
                      <ComboboxEmpty>No categories found.</ComboboxEmpty>
                      <ComboboxList>
                        {categories.map((cat) => (
                          <ComboboxItem key={cat.id} value={cat.id}>
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: cat.color }}
                            />
                            {cat.icon && (
                              <Icon
                                name={cat.icon}
                                className="h-4 w-4 opacity-75 shrink-0"
                              />
                            )}
                            <span className="truncate">{cat.name}</span>
                          </ComboboxItem>
                        ))}
                      </ComboboxList>
                    </ComboboxContent>
                  </Combobox>

                  {selectedCategories.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setSelectedCategories([])}
                      className="text-xs text-muted-foreground hover:text-foreground h-8 px-2"
                    >
                      Clear filter
                    </Button>
                  )}
                </div>
              </div>

              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2 }}
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
                  gap: "5px",
                }}
              >
                <AnimatePresence mode="popLayout">
                  {filteredItems.length === 0 ? (
                    <div className="col-span-full py-16 flex flex-col items-center justify-center text-center gap-2">
                      <Filter className="h-8 w-8 text-muted-foreground/30 animate-pulse" />
                      <p className="text-sm font-medium text-muted-foreground">
                        No items match your filter criteria
                      </p>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() => setSelectedCategories([])}
                        className="text-xs text-primary h-auto p-0"
                      >
                        Clear Category Filter
                      </Button>
                    </div>
                  ) : (
                    filteredItems.map((item, index) => {
                      const isStream = !!(
                        item.isStream ||
                        item.filePath.startsWith("http://") ||
                        item.filePath.startsWith("https://")
                      );
                      return (
                        <LibraryCard
                          key={item.id}
                          item={item}
                          categoryName={
                            !isStream
                              ? categories.find((c) => c.id === item.categoryId)
                                  ?.name
                              : undefined
                          }
                          categoryIcon={
                            !isStream
                              ? categories.find((c) => c.id == item.categoryId)
                                  ?.icon
                              : undefined
                          }
                          categoryColor={
                            !isStream
                              ? categories.find((c) => c.id == item.categoryId)
                                  ?.color
                              : undefined
                          }
                          streamColor={settings.audioStreamColor || "#a78bfa"}
                          streamIcon={settings.audioStreamIcon || "radio"}
                          index={index}
                          isSelected={selectedId === item.id}
                          isPlaying={playingItemId === item.id}
                          onSelect={(id) =>
                            setSelectedId((prev) => (prev === id ? null : id))
                          }
                          onPlay={() => {
                            setPlayingItemId(item.id);
                          }}
                          onRemove={handleRemoveItem}
                          onAddToFlow={handleAddToFlow}
                          onAddToTimeline={handleAddToTimeline}
                          onOpenProperties={setPropertiesItem}
                        />
                      );
                    })
                  )}
                </AnimatePresence>
              </motion.div>
            </div>

            {/* Floating Buttons */}
            <motion.div
              initial={{ opacity: 0, bottom: "20px" }}
              animate={{ opacity: 1, bottom: playingItemId ? "150px" : "20px" }}
              transition={{
                type: "spring",
                bounce: 0,
                delay: 0,
                duration: 0.4,
              }}
              style={{
                position: "absolute",
                left: "20px",
                zIndex: 10,
              }}
              className="gap-5"
            >
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <DropdownMenuTrigger
                        render={
                          <Button
                            size="lg"
                            className="ml-2 shadow-lg h-11 w-11 rounded-full"
                          >
                            <PlusIcon className="h-4 w-4" />
                          </Button>
                        }
                      />
                    }
                  />
                  <TooltipContent>
                    <p>Add audio</p>
                  </TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" side="top" className="mb-2">
                  <DropdownMenuItem
                    onClick={handleAddFiles}
                    className="cursor-pointer"
                  >
                    <PlusIcon className="h-4 w-4" />
                    Add Audio Files
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => {
                      setPrefilledStreamTitle("");
                      setPrefilledStreamUrl("");
                      setAddStreamOpen(true);
                    }}
                    className="cursor-pointer"
                  >
                    <Radio className="h-4 w-4" />
                    Add Stream
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => setRecordingOpen(true)}
                    className="cursor-pointer"
                  >
                    <Mic className="h-4 w-4" />
                    Record Audio
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleAddSpotify}
                    className="cursor-pointer"
                  >
                    <IconBrandSpotify className="h-4 w-4" />
                    Add from Spotify
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="secondary"
                      size="icon"
                      className="ml-2 shadow-lg h-11 w-11 rounded-full"
                      onClick={() => setManagerOpen(true)}
                    >
                      <TagsIcon className="h-5 w-5" />
                    </Button>
                  }
                ></TooltipTrigger>
                <TooltipContent>
                  <p>Manage Categories</p>
                </TooltipContent>
              </Tooltip>
            </motion.div>
          </>
        )}
      </div>
      <LibraryItemPropertiesDialog
        item={propertiesItem}
        open={!!propertiesItem}
        onOpenChange={(open) => {
          if (!open) setPropertiesItem(null);
        }}
      />
      <CategoryManagerDialog open={managerOpen} onOpenChange={setManagerOpen} />
      <RecordingDialog
        open={recordingOpen}
        onOpenChange={setRecordingOpen}
        onSave={(item) => setItems((prev) => [...prev, item])}
      />
      <AddStreamDialog
        open={addStreamOpen}
        onOpenChange={setAddStreamOpen}
        onSave={(item) => setItems((prev) => [...prev, item])}
        initialTitle={prefilledStreamTitle}
        initialUrl={prefilledStreamUrl}
      />
      <AddAudioDialog
        open={addAudioOpen}
        onOpenChange={handleAddAudioOpenChange}
        filePath={addAudioQueue.length > 0 ? addAudioQueue[0] : null}
        onSave={handleSaveAudioItem}
      />
      <motion.div
        initial={false}
        animate={{ y: playingItemId ? 0 : "100%" }}
        transition={{ type: "spring", bounce: 0, duration: 0.4 }}
        className="fixed bottom-0 left-0 right-0 z-50 p-0 border-t shadow-2xl rounded-t-xl bg-card max-h-[80vh] flex flex-col overflow-hidden"
        style={{ pointerEvents: playingItemId ? "auto" : "none" }}
      >
        <VisualizerBackdrop visible={!!playingItemId && showVisualizer} />
        <div className="w-full flex flex-col py-1 relative z-10">
          {playingItemId && (
            <>
              {items.find((i) => i.id === playingItemId) && (
                <LibraryAudioPlayerWrapper
                  key={playingItemId}
                  item={items.find((i) => i.id === playingItemId)!}
                  onStop={handleStopPlaying}
                  showVisualizer={showVisualizer}
                  onToggleVisualizer={() => setShowVisualizer(!showVisualizer)}
                />
              )}
            </>
          )}
        </div>
      </motion.div>
    </AnimatedRoute>
  );
}

// Library Card Component
function LibraryCard({
  item,
  categoryName,
  categoryIcon,
  categoryColor,
  streamColor,
  streamIcon,
  index,
  isSelected,
  isPlaying,
  onSelect,
  onPlay,
  onRemove,
  onAddToFlow,
  onAddToTimeline,
  onOpenProperties,
}: {
  item: LibraryItem;
  categoryName?: string;
  categoryIcon?: IconName | "";
  categoryColor?: string;
  streamColor: string;
  streamIcon: string;
  index: number;
  isSelected: boolean;
  isPlaying: boolean;
  onSelect: (id: string) => void;
  onPlay: () => void;
  onRemove: (id: string) => void;
  onAddToFlow: (item: LibraryItem) => void;
  onAddToTimeline: (item: LibraryItem) => void;
  onOpenProperties: (item: LibraryItem) => void;
}) {
  const isStream = !!(
    item.isStream ||
    item.filePath.startsWith("http://") ||
    item.filePath.startsWith("https://")
  );
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    e.dataTransfer.setData(
      "application/sonicplank/library-item",
      JSON.stringify(item),
    );
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger>
        <div
          draggable
          onDragStart={handleDragStart}
          style={{ display: "contents" }}
        >
          <motion.div
            layout
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: index * 0.03, duration: 0.1 }}
            onClick={() => onSelect(item.id)}
            onDoubleClick={() => onPlay()}
            className={cn(
              "border p-[14px] cursor-pointer transition-all duration-200 relative group bg-zinc-950/45 border-zinc-800 text-white shadow-lg rounded-xl",
              isSelected
                ? "border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.35)] ring-1 ring-indigo-500/30 bg-zinc-950/80"
                : "hover:bg-zinc-900/60 hover:border-zinc-700",
            )}
          >
            {/* Album Art */}
            <div className="w-full aspect-square rounded-lg bg-zinc-950 flex items-center justify-center mb-3 overflow-hidden relative border border-zinc-900">
              {item.albumArt ? (
                <img
                  src={item.albumArt}
                  alt={`${item.title} album art`}
                  className="w-full h-full object-cover"
                />
              ) : isStream ? (
                <div
                  className="p-3.5 rounded-xl border"
                  style={{
                    backgroundColor: `${streamColor || "#a78bfa"}10`,
                    borderColor: `${streamColor || "#a78bfa"}20`,
                    color: streamColor || "#a78bfa",
                  }}
                >
                  <Icon
                    name={streamIcon as IconName}
                    size={28}
                    strokeWidth={1.5}
                  />
                </div>
              ) : categoryIcon ? (
                <div
                  className="p-3.5 rounded-xl border"
                  style={{
                    backgroundColor: `${categoryColor || "#71717a"}15`,
                    borderColor: `${categoryColor || "#71717a"}25`,
                    color: categoryColor || "#a1a1aa",
                  }}
                >
                  <Icon name={categoryIcon} size={28} strokeWidth={1.5} />
                </div>
              ) : (
                <div className="p-3.5 rounded-xl border bg-zinc-500/10 border-zinc-500/20 text-zinc-400">
                  <MusicIcon size={28} />
                </div>
              )}

              {/* Play Overlay */}
              <div
                className={cn(
                  "absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity duration-200 z-10",
                  isPlaying
                    ? "opacity-100"
                    : "opacity-0 group-hover:opacity-100",
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  onPlay();
                }}
              >
                <PlayCircleIcon
                  className={cn(
                    "text-white/90 drop-shadow-md",
                    isPlaying ? "h-12 w-12 animate-pulse" : "h-10 w-10",
                  )}
                />
              </div>
            </div>

            {/* Metadata */}
            <div className="flex flex-col gap-0.5">
              <p
                className="text-sm font-medium text-foreground truncate"
                title={item.title}
              >
                {item.title}
              </p>
              {isStream ? (
                <p
                  className="text-xs text-muted-foreground truncate"
                  title="Various"
                >
                  {"Various"}
                </p>
              ) : (
                <p
                  className="text-xs text-muted-foreground truncate"
                  title={item.artist}
                >
                  {item.artist || <>&nbsp;</>}
                </p>
              )}
              <p className="text-xs text-muted-foreground/60 mt-1 flex justify-between">
                <span>
                  {isStream ? "Live Stream" : formatDuration(item.duration)}
                </span>
                {isStream ? (
                  <span
                    className="bg-primary/10 px-1.5 py-0.5 rounded-sm truncate max-w-[80px]"
                    style={{
                      color: streamColor,
                    }}
                    title="Stream"
                  >
                    Stream
                  </span>
                ) : categoryName ? (
                  <span
                    className="bg-primary/10 px-1.5 py-0.5 rounded-sm truncate max-w-[80px]"
                    style={{
                      color: categoryColor,
                    }}
                    title={categoryName}
                  >
                    {categoryName}
                  </span>
                ) : (
                  <span
                    className="bg-primary/10 px-1.5 py-0.5 rounded-sm truncate max-w-[80px]"
                    style={{
                      color: "#a1a1aa",
                      backgroundColor: "transparent",
                    }}
                    title="None"
                  >
                    &nbsp;
                  </span>
                )}
              </p>
            </div>
          </motion.div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        {!isStream && (
          <>
            <ContextMenuItem onClick={() => onAddToFlow(item)}>
              <WorkflowIcon className="h-4 w-4" />
              Add to Flow
            </ContextMenuItem>
            <ContextMenuItem onClick={() => onAddToTimeline(item)}>
              <ListMusicIcon className="h-4 w-4" />
              Add to Sonics
            </ContextMenuItem>
          </>
        )}
        <ContextMenuItem onClick={() => onOpenProperties(item)}>
          <Settings2Icon className="h-4 w-4" />
          Properties
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          variant="destructive"
          onClick={() => onRemove(item.id)}
        >
          <Trash2Icon className="h-4 w-4" />
          Remove from Library
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
