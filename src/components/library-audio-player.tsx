import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { LibraryItem } from "@/types/library-item";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SquareIcon, ActivityIcon } from "lucide-react";
import {
  AudioPlayer,
  AudioPlayerControlBar,
  AudioPlayerPlay,
  AudioPlayerSeekBar,
  AudioPlayerTimeDisplay,
  AudioPlayerVolume,
} from "@/components/audio/player";
import { useAudioStore } from "@/lib/audio-store";
import { useAudio } from "@/hooks/use-audio";

interface LibraryAudioPlayerProps {
  item: LibraryItem;
  onStop: () => void;
  showVisualizer: boolean;
  onToggleVisualizer: () => void;
}

export function LibraryAudioPlayerWrapper({
  item,
  onStop,
  showVisualizer,
  onToggleVisualizer,
}: LibraryAudioPlayerProps) {
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
    const handleEnded = () => onStop();
    audio.addEventListener("ended", handleEnded);
    return () => audio.removeEventListener("ended", handleEnded);
  }, [htmlAudio, onStop]);

  useEffect(() => {
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
              style={{ width: "40px", height: "40px" }}
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
