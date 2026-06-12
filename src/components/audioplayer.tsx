// AudioPlayer.tsx
import React, { useRef, useState, useEffect } from "react";
import {
  ScrubBarContainer,
  ScrubBarProgress,
  ScrubBarThumb,
  ScrubBarTimeLabel,
  ScrubBarTrack,
} from "@/components/ui/scrub-bar";
import { toast } from "sonner";
import { Label } from "@/components/ui/label";
import { CardAction, CardContent, CardFooter } from "@/components/ui/card";
import {
  ButtonGroup,
  ButtonGroupSeparator,
} from "@/components/ui/button-group";
import { Button } from "@/components/ui/button";
import { PauseCircleIcon, PlayCircleIcon, StopCircleIcon } from "lucide-react";
import WaveSurfer, { WaveSurferOptions } from "wavesurfer.js";
import { IconAlertOctagon } from "@tabler/icons-react";
import { useStateMachine } from "@/store/stateMachine";
import { Knob } from "@/components/audio/knob";
import { Slider } from "./ui/slider";
// import { Waveform } from "./ui/waveform";

interface AudioPlayerProps {
  id: string;
  options: WaveSurferOptions;
  initialvolume: number;
  onVolumeChange?: (volume: number) => void;
  hideWaveform?: boolean;
  onStop?: () => void;
}

export const AudioPlayer: React.FC<AudioPlayerProps> = ({
  id,
  options,
  initialvolume,
  onVolumeChange,
  hideWaveform = false,
  onStop,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { initInstance, destroyInstance } = useStateMachine();
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [ws, setWs] = useState<WaveSurfer | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const newWs = initInstance(id, containerRef.current, options);
    setWs(newWs);

    newWs.on("play", () => setIsPlaying(true));
    newWs.on("pause", () => {
      setCurrentTime(newWs.getCurrentTime().toFixed(0) as unknown as number);
      setIsPlaying(false);
    });
    newWs.on("finish", () => {
      newWs.stop();
      onStop?.();
    });
    newWs.on("error", (err) => {
      console.error("WaveSurfer error in AudioPlayer:", err);
      toast("Error loading audio", {
        icon: <IconAlertOctagon color="red" style={{ paddingRight: "6px" }} />,
        description: <div>{err as unknown as string}</div>,
        duration: 5000,
      });
    });
    newWs.on("timeupdate", () => {
      const current = newWs.getCurrentTime();
      const dur = newWs.getDuration();
      if (dur && current.toFixed(0) === dur.toFixed(0)) {
        newWs.stop();
        onStop?.();
      } else if (currentTime.toFixed(0) !== current.toFixed(0)) {
        setCurrentTime(current);
      }
    });

    return () => {
      destroyInstance(id);
    };
  }, [id, initInstance, destroyInstance, onStop]);

  function handleVolumeChange(
    value?: number | null,
    passedEvent?: React.WheelEvent<HTMLDivElement> | null,
  ) {
    let newVolume = 0;
    if (passedEvent) {
      newVolume =
        passedEvent.deltaY == -100
          ? volume + 1
          : passedEvent.deltaY == 100
            ? volume - 1
            : volume;
      if (newVolume < 0) {
        newVolume = 0;
      }
      if (newVolume > 100) {
        newVolume = 100;
      }
    } else if (value != null) {
      newVolume = value;
    }
    setVolume(newVolume);
    ws?.setVolume(newVolume / 100);
    onVolumeChange?.(newVolume / 100);
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

  const [volume, setVolume] = useState(initialvolume);

  const error = null as Error | null;
  const isLoading = false;

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
      {!hideWaveform ? (
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
            borderRadius: "var(--radius-sm)",
          }}
          className="nodrag nopan nowheel pt-2!"
        >
          <div ref={containerRef} />
        </CardContent>
      ) : (
        <div
          ref={containerRef}
          style={{ visibility: "hidden", display: "none" }}
        />
      )}
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
      {hideWaveform ? (
        <div className="flex flex-col gap-2 pt-2 w-full">
          {isLoading ? (
            <div className="flex justify-center items-center py-2 text-muted-foreground text-sm">
              Loading..
            </div>
          ) : error ? null : (
            <div className="flex flex-row w-full justify-between items-center px-2 pb-2">
              <ButtonGroup>
                <Button
                  id={`playPauseButton_${id}`}
                  variant="ghost"
                  onClick={() => togglePlay()}
                  className="nodrag rounded-full"
                >
                  {isPlaying ? <PauseCircleIcon /> : <PlayCircleIcon />}
                </Button>
                <Button
                  variant="ghost"
                  disabled={!isPlaying}
                  onClick={() => {
                    ws?.stop();
                    onStop?.();
                  }}
                  className="nodrag"
                >
                  <StopCircleIcon />
                </Button>
              </ButtonGroup>
              <div className="flex items-center gap-3 w-[150px]">
                <Label className="nodrag text-xs text-muted-foreground">
                  {(volume | 0).toFixed(0)}%
                </Label>
                <Knob
                  className="nodrag nopan nowheel"
                  id={`volume-slider-${id}`}
                  max={100}
                  min={0}
                  value={volume}
                  size="sm"
                  step={1}
                  onWheel={(evt) => {
                    handleVolumeChange(null, evt);
                  }}
                  onValueChange={(value) => {
                    handleVolumeChange(value, null);
                  }}
                />
              </div>
            </div>
          )}
        </div>
      ) : (
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
                  <Button
                    id={`playPauseButton_${id}`}
                    style={{
                      borderBottomRightRadius: "0",
                      borderTopRightRadius: "0",
                    }}
                    onClick={() => togglePlay()}
                    className="nodrag"
                  >
                    {isPlaying ? <PauseCircleIcon /> : <PlayCircleIcon />}
                  </Button>
                  <ButtonGroupSeparator />
                  <Button
                    style={{
                      borderBottomLeftRadius: "0",
                      borderTopLeftRadius: "0",
                    }}
                    disabled={!isPlaying}
                    onClick={() => {
                      ws?.stop();
                      onStop?.();
                    }}
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
                  <Label className="nodrag">{volume | 0}%</Label>
                  <Knob
                    className="nodrag nopan nowheel"
                    id={`volume-slider-${id}`}
                    max={100}
                    min={0}
                    value={volume}
                    size="sm"
                    style={{
                      transform: " scale(0.75)",
                    }}
                    step={1}
                    onWheel={(evt) => {
                      handleVolumeChange(null, evt);
                    }}
                    onValueChange={(value) => {
                      handleVolumeChange(value, null);
                    }}
                  />
                </div>
              </div>
            </CardAction>
          )}
        </CardFooter>
      )}
    </>
  );
};
