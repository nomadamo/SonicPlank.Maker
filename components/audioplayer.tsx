// AudioPlayer.tsx
import React, { useRef, useState } from "react";
// import { useWaveSurferContext } from "../store/wavesurferprovider";
import {
  ScrubBarContainer,
  ScrubBarProgress,
  ScrubBarThumb,
  ScrubBarTimeLabel,
  ScrubBarTrack,
} from "@/components/ui/scrub-bar";
import { toast } from "sonner";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { WaveSurferOptions } from "wavesurfer.js";
import { CardAction, CardContent, CardFooter } from "@/components/ui/card";
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from "@/components/ui/button-group";
import { BaseUIEvent } from "@base-ui/react";
import { Button } from "@/components/ui/button";
import { PauseCircleIcon, PlayCircleIcon, StopCircleIcon } from "lucide-react";
import WaveSurfer from "wavesurfer.js";
import { useQuery } from "@tanstack/react-query";
import { IconAlertOctagon } from "@tabler/icons-react";
import { useStateMachine } from "@/store/stateMachine";

interface AudioPlayerProps {
  id: string;
  options: WaveSurferOptions;
  initialvolume: number;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  id,
  options,
  initialvolume,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { initInstance, destroyInstance } = useStateMachine();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const wsRef = useRef<WaveSurfer | null>(null);

  interface WaveSurferCache {
    id: string;
    payload: WaveSurfer;
    lastUpdated: number;
  }

  const loadAudio = async (): Promise<WaveSurferCache> => {
    return new Promise((resolve) => {
      const tempWs = initInstance(id, containerRef.current, options);
      wsRef.current = tempWs;

      tempWs.on("play", () => setIsPlaying(true));
      tempWs.on("pause", () => {
        setCurrentTime(tempWs.getCurrentTime().toFixed(0) as unknown as number);
        setIsPlaying(false);
      });
      tempWs.on("finish", () => {
        tempWs.stop();
      });
      tempWs.on("timeupdate", () => {
        if (currentTime.toFixed(0) == duration?.toFixed(0)) {
          tempWs.stop();
        } else if (
          currentTime.toFixed(0) !== tempWs.getCurrentTime().toFixed(0)
        ) {
          setCurrentTime(tempWs.getCurrentTime());
        }
      });

      resolve({
        id: `persist_${id}`,
        payload: tempWs,
        lastUpdated: Date.now(),
      });
    });
  };

  const { data, isLoading, error } = useQuery<WaveSurferCache, Error>({
    queryKey: [`persist_${id}`],
    queryFn: loadAudio,

    // Crucial settings for preserving data across navigation:

    // Consider data fresh for 24 hours so it won't re-fetch on remount
    staleTime: 1000 * 60 * 60 * 24,

    // Keep unused data in the cache memory for 24 hours before garbage collection
    gcTime: 1000 * 60 * 60 * 24,

    // Optional: Prevent background refetching when user refocuses the app window
    refetchOnWindowFocus: false,

    // Optional: Prevent refetching when network reconnects
    refetchOnReconnect: false,
  });

  const ws = data?.payload;

  function handleVolumeChange(
    inVolume: number,
    value?: number | null,
    passedEvent?: BaseUIEvent<React.WheelEvent<HTMLDivElement>> | null,
  ) {
    let newVolume = 0;
    if (passedEvent) {
      newVolume =
        passedEvent.deltaY == -100
          ? volume + 0.01
          : passedEvent.deltaY == 100
            ? inVolume - 0.01
            : inVolume;
      if (newVolume < 0) {
        newVolume = 0;
      }
      if (newVolume > 1) {
        newVolume = 1;
      }
    } else if (value) {
      newVolume = value;
    }
    setVolume(newVolume);
    ws?.setVolume(newVolume);
  }

  const togglePlay = () => {
    ws?.playPause();
  };

  // useEffect(() => {
  //   if (!ws) return;
  //   plugins[0].enableDragSelection({ color: "#CCCCCC22" });
  // }, [ws]);

  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const duration = ws?.getDuration();
  function PlayPauseButton({ id }: { id: string }) {
    return (
      <Button
        id={id}
        style={{
          borderBottomRightRadius: "0",
          borderTopRightRadius: "0",
        }}
        onClick={() => togglePlay()}
        className="nodrag"
      >
        {isPlaying ? <PauseCircleIcon /> : <PlayCircleIcon />}
      </Button>
    );
  }

  const [volume, setVolume] = useState(initialvolume);

  if (error) {
    toast(error.message, {
      icon: (
        <IconAlertOctagon
          color="red"
          type="error"
          style={{ paddingRight: "6px" }}
        />
      ),
      description: <div>{error.stack as unknown as string}</div>,
      dismissible: false,
      duration: 10000,
    });
  }

  return (
    <>
      <CardContent
        style={{
          backgroundColor: "var(--card-background)",
          padding: "2px",
          margin: "0",
          alignSelf: "center",
          height: "90px",
          width: "90%",
          overflow: "hidden",
          border: "1px",
          borderColor: "rgba(120, 120, 120, 0.2)",
          borderStyle: "ridge",
          borderRadius: "var(--radius)",
        }}
        className="nodrag nopan nowheel"
        ref={containerRef}
      />
      <ScrubBarContainer
        className={isPlaying ? "nodrag " : "nodrag disabled"}
        style={{ width: "90%", alignSelf: "center" }}
        duration={duration ? duration : 0}
        value={currentTime}
        onScrub={(value) => {
          ws?.seekTo(value / (duration || 1));
        }}
        draggable={isPlaying}
      >
        <ScrubBarTimeLabel
          className={!isPlaying ? "dim" : ""}
          time={currentTime}
        />
        <ScrubBarTrack className={isPlaying ? "mx-4" : "mx-4 disabled"}>
          <ScrubBarProgress />
          <ScrubBarThumb />
        </ScrubBarTrack>
        <ScrubBarTimeLabel time={duration || 0} />
      </ScrubBarContainer>
      <CardFooter style={{ height: "65px", padding: "15px", width: "100%" }}>
        {isLoading ? (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            Loading..
          </div>
        ) : error ? (
          <></>
        ) : (
          <CardAction style={{ width: "100%" }}>
            <div
              style={{
                display: "inline-flex",
                flexDirection: "row",
                width: "100%",
                justifyContent: "space-between",
                gap: "5px",
              }}
            >
              <ButtonGroup>
                <PlayPauseButton id={`playPauseButton_${id}`} />
                <ButtonGroupSeparator />
                <Button
                  style={{
                    borderBottomLeftRadius: "0",
                    borderTopLeftRadius: "0",
                  }}
                  disabled={!isPlaying}
                  onClick={() => ws?.stop()}
                  className="nodrag"
                >
                  <StopCircleIcon />
                </Button>
              </ButtonGroup>
              <div
                style={{
                  paddingLeft: "5px",
                  paddingRight: "5px",
                  display: "inline-flex",
                  justifyContent: "space-between",
                  gap: "10px",
                  width: "500",
                  alignItems: "center",
                }}
              >
                <Label className="nodrag">
                  {((volume * 100) | 0).toFixed(0)}%
                </Label>
                <Slider
                  className="nodrag nopan nowheel"
                  id={`volume-slider-${id}`}
                  style={{ width: "150px", marginLeft: "10px" }}
                  max={1}
                  min={0}
                  value={volume}
                  step={0.01}
                  onWheel={(evt) => {
                    handleVolumeChange(volume, null, evt);
                  }}
                  onValueChange={(value) => {
                    handleVolumeChange(volume, value as number, null);
                  }}
                  disabled={!isPlaying}
                />
              </div>
            </div>
          </CardAction>
        )}
      </CardFooter>
    </>
  );
};
