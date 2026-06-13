import * as React from "react";
import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useSettings } from "@/store/settingsStore";
import {
  Play,
  Pause,
  Square,
  Mic,
  Save,
  RefreshCw,
  Volume2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LibraryItem } from "@/types/library-item";
import { Knob } from "@/components/audio/knob";

interface RecordingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (item: LibraryItem) => void;
}

type RecordingStatus = "idle" | "recording" | "stopped" | "saving";

export function RecordingDialog({
  open,
  onOpenChange,
  onSave,
}: RecordingDialogProps) {
  const { settings } = useSettings();
  const [status, setStatus] = useState<RecordingStatus>("idle");
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [tempDeviceId, setTempDeviceId] = useState<string>("default");
  const [stream, setStream] = useState<MediaStream | null>(null);

  // Recording chunks and timer states
  const [recordDuration, setRecordDuration] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Playback preview states
  const [isPlayingBack, setIsPlayingBack] = useState(false);
  const [playbackProgress, setPlaybackProgress] = useState(0);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playbackAudioRef = useRef<HTMLAudioElement | null>(null);

  const [inputVolume, setInputVolume] = useState(1.0);
  const levelCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const levelStateRef = useRef({
    rms: 0,
    peak: 0,
    peakHold: 0,
    peakHoldTime: 0,
  });

  // Initialize input override based on current settings when dialog is opened
  useEffect(() => {
    if (open) {
      setTempDeviceId(settings.audioInputDeviceId || "default");
      setStatus("idle");
      setRecordedBlob(null);
      setAudioUrl(null);
      setPlaybackProgress(0);
      setIsPlayingBack(false);

      // Enumerate available input devices
      navigator.mediaDevices
        .getUserMedia({ audio: true })
        .then(() => navigator.mediaDevices.enumerateDevices())
        .catch(() => navigator.mediaDevices.enumerateDevices())
        .then((devices) => {
          setInputDevices(devices.filter((d) => d.kind === "audioinput"));
        })
        .catch((err) => {
          console.error("[RecordDialog] Error fetching media devices", err);
        });
    }
  }, [open, settings.audioInputDeviceId]);

  // Request new audio stream when temporary override changes or on open
  useEffect(() => {
    if (!open) return;

    let activeStream: MediaStream | null = null;
    const constraints: MediaStreamConstraints = {
      audio:
        tempDeviceId === "default"
          ? true
          : { deviceId: { exact: tempDeviceId } },
    };

    navigator.mediaDevices
      .getUserMedia(constraints)
      .then((s) => {
        activeStream = s;
        setStream(s);
      })
      .catch((err) => {
        console.error("[RecordDialog] Failed to obtain microphone stream", err);
      });

    return () => {
      if (activeStream) {
        activeStream.getTracks().forEach((track) => track.stop());
      }
      setStream(null);
    };
  }, [tempDeviceId, open]);

  // Set up Web Audio context and routing graph
  useEffect(() => {
    if (!stream || !open) return;

    const audioCtxClass =
      window.AudioContext || (window as any).webkitAudioContext;
    const audioCtx = new audioCtxClass();
    audioCtxRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);
    const gainNode = audioCtx.createGain();
    const initialVol = Number.isFinite(inputVolume) ? inputVolume : 1.0;
    gainNode.gain.setValueAtTime(initialVol, audioCtx.currentTime);
    gainNodeRef.current = gainNode;

    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    analyser.smoothingTimeConstant = 0.5;
    analyserRef.current = analyser;

    const destNode = audioCtx.createMediaStreamDestination();
    destNodeRef.current = destNode;

    source.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(destNode);

    return () => {
      audioCtx.close().catch(() => {});
      audioCtxRef.current = null;
      gainNodeRef.current = null;
      analyserRef.current = null;
      destNodeRef.current = null;
    };
  }, [stream, open]);

  // Update GainNode value when inputVolume state updates
  useEffect(() => {
    if (
      gainNodeRef.current &&
      audioCtxRef.current &&
      Number.isFinite(inputVolume)
    ) {
      gainNodeRef.current.gain.setValueAtTime(
        inputVolume,
        audioCtxRef.current.currentTime,
      );
    }
  }, [inputVolume]);

  // Canvas Oscilloscope & Level Meter Visualizer Loop
  useEffect(() => {
    if (!stream || !open) return;

    const canvas = canvasRef.current;
    const levelCanvas = levelCanvasRef.current;
    if (!canvas || !levelCanvas) return;

    const ctx = canvas.getContext("2d");
    const levelCtx = levelCanvas.getContext("2d");
    if (!ctx || !levelCtx) return;

    let animationId: number;

    const dpr = window.devicePixelRatio || 1;

    // Set up canvas sizing
    const handleResize = () => {
      const rect = canvas.getBoundingClientRect();
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);

      const levelRect = levelCanvas.getBoundingClientRect();
      levelCanvas.width = levelRect.width * dpr;
      levelCanvas.height = levelRect.height * dpr;
      levelCtx.scale(dpr, dpr);
    };

    handleResize();

    const bufferLength = 128; // analyser fftSize frequencyBinCount
    const dataArray = new Uint8Array(bufferLength);

    const draw = () => {
      animationId = requestAnimationFrame(draw);

      const analyser = analyserRef.current;
      if (!analyser) return;

      analyser.getByteTimeDomainData(dataArray);

      // Compute peak and RMS
      let peak = 0;
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        const val = (dataArray[i] - 128) / 128;
        sum += val * val;
        const absVal = Math.abs(val);
        if (absVal > peak) {
          peak = absVal;
        }
      }
      const rms = Math.sqrt(sum / bufferLength);

      // Smooth levels
      const state = levelStateRef.current;
      state.rms = state.rms * 0.8 + rms * 0.2;
      if (peak > state.peak) {
        state.peak = peak;
      } else {
        state.peak = state.peak * 0.92;
      }

      if (peak > state.peakHold) {
        state.peakHold = peak;
        state.peakHoldTime = 30;
      } else {
        if (state.peakHoldTime > 0) {
          state.peakHoldTime--;
        } else {
          state.peakHold = state.peakHold * 0.95;
        }
      }

      // 1. Draw Oscilloscope Wave
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.clearRect(0, 0, w, h);

      ctx.fillStyle = "rgba(10, 10, 12, 0.4)";
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h / 2);
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      ctx.lineWidth = 2.5;
      ctx.strokeStyle = "rgb(14, 165, 233)"; // Sky-500
      ctx.beginPath();
      const sliceWidth = w / bufferLength;
      let x = 0;
      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        const y = (v * h) / 2;
        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
        x += sliceWidth;
      }
      ctx.lineTo(w, h / 2);
      ctx.stroke();

      // 2. Draw Horizontal Level Meter
      const lw = levelCanvas.width / dpr;
      const lh = levelCanvas.height / dpr;
      levelCtx.clearRect(0, 0, lw, lh);

      levelCtx.fillStyle = "rgba(10, 10, 12, 0.6)";
      levelCtx.fillRect(0, 0, lw, lh);

      const rmsWidth = state.rms * lw * 1.5;
      const peakWidth = state.peak * lw * 1.5;
      const peakHoldX = state.peakHold * lw * 1.5;

      const grad = levelCtx.createLinearGradient(0, 0, lw, 0);
      grad.addColorStop(0, "#22c55e");
      grad.addColorStop(0.65, "#eab308");
      grad.addColorStop(0.9, "#ef4444");

      levelCtx.fillStyle = grad;
      levelCtx.fillRect(0, 0, Math.min(lw, rmsWidth), lh);

      levelCtx.fillStyle = grad;
      levelCtx.globalAlpha = 0.45;
      levelCtx.fillRect(0, 0, Math.min(lw, peakWidth), lh);
      levelCtx.globalAlpha = 1.0;

      if (state.peakHold > 0.005) {
        const lineX = Math.max(0, Math.min(lw - 2, peakHoldX));
        levelCtx.fillStyle = state.peakHold > 0.8 ? "#ef4444" : "#f4f4f5";
        levelCtx.fillRect(lineX, 0, 1.5, lh);
      }

      levelCtx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      levelCtx.lineWidth = 1;
      const tickSteps = 10;
      for (let i = 1; i < tickSteps; i++) {
        const tx = (i / tickSteps) * lw;
        levelCtx.beginPath();
        levelCtx.moveTo(tx, 0);
        levelCtx.lineTo(tx, lh);
        levelCtx.stroke();
      }
    };

    draw();

    return () => {
      cancelAnimationFrame(animationId);
    };
  }, [stream, open]);

  // Audio preview playback sync
  useEffect(() => {
    if (!audioUrl || status !== "stopped") return;

    const audio = new Audio(audioUrl);
    playbackAudioRef.current = audio;

    const updateProgress = () => {
      if (audio.duration) {
        setPlaybackProgress(audio.currentTime / audio.duration);
      }
    };

    const handleEnded = () => {
      setIsPlayingBack(false);
      setPlaybackProgress(0);
    };

    const handlePause = () => setIsPlayingBack(false);
    const handlePlay = () => setIsPlayingBack(true);

    audio.addEventListener("timeupdate", updateProgress);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("play", handlePlay);

    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", updateProgress);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("play", handlePlay);
      playbackAudioRef.current = null;
    };
  }, [audioUrl, status]);

  // Initialize custom filename when recording completes
  useEffect(() => {
    if (status === "stopped") {
      const now = new Date();
      const dateStr = now
        .toISOString()
        .replace(/T/, "-")
        .replace(/:/g, "")
        .split(".")[0];
      setFileName(`Recording-${dateStr}.wav`);
    }
  }, [status]);

  // Stop active playback review when closed
  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      if (playbackAudioRef.current) {
        playbackAudioRef.current.pause();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (
        mediaRecorderRef.current &&
        mediaRecorderRef.current.state !== "inactive"
      ) {
        mediaRecorderRef.current.stop();
      }
    }
    onOpenChange(isOpen);
  };

  const startRecording = () => {
    const streamToRecord = destNodeRef.current?.stream || stream;
    if (!streamToRecord) return;
    chunksRef.current = [];

    const mediaRecorder = new MediaRecorder(streamToRecord, {
      mimeType: "audio/webm",
    });
    mediaRecorderRef.current = mediaRecorder;

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
    };

    mediaRecorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "audio/webm" });
      setRecordedBlob(blob);
      setAudioUrl(URL.createObjectURL(blob));
      setStatus("stopped");
    };

    setRecordDuration(0);
    setStatus("recording");
    mediaRecorder.start(250);

    timerRef.current = setInterval(() => {
      setRecordDuration((prev) => prev + 1);
    }, 1000);
  };

  const stopRecording = () => {
    if (
      mediaRecorderRef.current &&
      mediaRecorderRef.current.state !== "inactive"
    ) {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const togglePlayback = () => {
    const audio = playbackAudioRef.current;
    if (!audio) return;

    if (isPlayingBack) {
      audio.pause();
    } else {
      audio.play().catch(console.error);
    }
  };

  // WAV compilation & Disk Writing
  const handleSave = async () => {
    if (!recordedBlob || !fileName.trim()) return;
    setIsSaving(true);

    try {
      const arrayBuffer = await recordedBlob.arrayBuffer();
      const audioCtxClass =
        window.AudioContext || (window as any).webkitAudioContext;
      const audioCtx = new audioCtxClass();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);

      // Encode float audio buffer to 16-bit PCM WAV ArrayBuffer
      const wavBuffer = audioBufferToWav(audioBuffer);

      // Save via Electron backend Documents folder
      const finalFileName = fileName.endsWith(".wav")
        ? fileName
        : `${fileName}.wav`;
      const filePath = await window.electron.saveRecording(
        finalFileName,
        wavBuffer,
        settings.recordingPath,
      );

      const item: LibraryItem = {
        id: crypto.randomUUID(),
        title: finalFileName.replace(/\.[^.]+$/, ""),
        artist: "Microphone Recording",
        filePath: filePath,
        duration: audioBuffer.duration,
        addedAt: Date.now(),
      };

      onSave(item);
      handleClose(false);
      await audioCtx.close();
    } catch (err) {
      console.error("[RecordDialog] Error compiling/saving WAV file", err);
    } finally {
      setIsSaving(false);
    }
  };

  const formatTime = (secs: number) => {
    const mins = Math.floor(secs / 60);
    const remainingSecs = secs % 60;
    return `${mins.toString().padStart(2, "0")}:${remainingSecs.toString().padStart(2, "0")}`;
  };

  const activeDevice = inputDevices.find((d) => d.deviceId === tempDeviceId);
  const tempDisplayLabel = activeDevice?.label || "System Default Input";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent style={{ maxWidth: "550px" }}>
        <DialogHeader>
          <DialogTitle>Record Audio</DialogTitle>
          <DialogDescription>
            Record new audio clips directly into your project library.
          </DialogDescription>
        </DialogHeader>
        <Separator />

        {/* Input Override Selector Row */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Audio Input (Temporary Override)
          </label>
          <Select
            value={tempDeviceId}
            onValueChange={(val) => setTempDeviceId(val || "default")}
            disabled={status === "recording"}
          >
            <SelectTrigger className="w-full">
              <SelectValue>{tempDisplayLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="default">System Default Input</SelectItem>
              {inputDevices.map((device) => (
                <SelectItem key={device.deviceId} value={device.deviceId}>
                  {device.label ||
                    `Microphone (${device.deviceId.slice(0, 5)}...)`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Visualizer & Level Meter Container */}
        <div className="w-full relative bg-[#0a0a0c] rounded-xl overflow-hidden border border-border/50 p-2 flex flex-col gap-2">
          {/* Oscilloscope Waveform Display */}
          <div className="w-full h-36 relative bg-[#060608] rounded-lg overflow-hidden flex items-center justify-center">
            <canvas ref={canvasRef} className="w-full h-full block" />
            {status === "recording" && (
              <div className="absolute top-3 right-3 flex items-center gap-1.5 bg-background/80 backdrop-blur-sm border border-red-500/30 px-2.5 py-1 rounded-full text-red-500 font-mono text-xs font-bold animate-pulse">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                {formatTime(recordDuration)}
              </div>
            )}
          </div>

          {/* Level Meter (Horizontal) */}
          <div className="w-full h-3 bg-black/50 border border-border/30 rounded-md overflow-hidden relative">
            <canvas ref={levelCanvasRef} className="w-full h-full block" />
          </div>
        </div>

        {/* Input Gain Control */}
        <div className="flex items-center justify-between gap-4 bg-secondary/15 rounded-xl p-3 border border-border/40">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground text-left">
              Input Gain
            </span>
            <span className="text-[11px] text-muted-foreground text-left">
              Boost or attenuate incoming signal
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Volume2 className="h-4 w-4 text-muted-foreground shrink-0" />
            <Knob
              value={inputVolume}
              min={0}
              max={2.0}
              step={0.05}
              onValueChange={(val) => {
                if (Number.isFinite(val)) {
                  setInputVolume(val);
                }
              }}
              size="sm"
              className="shrink-0 text-primary"
            />
            <span className="font-mono text-sky-500 font-bold w-12 text-right">
              {Math.round(inputVolume * 100)}%
            </span>
          </div>
        </div>

        {/* State Conditional Footer & Auditing controls */}
        {status === "stopped" && (
          <div className="flex flex-col gap-4 border border-border/40 bg-secondary/15 rounded-xl p-3">
            {/* Playback preview controller */}
            <div className="flex items-center gap-3 w-full">
              <Button
                variant="outline"
                size="icon"
                onClick={togglePlayback}
                className="h-9 w-9 rounded-full shrink-0"
              >
                {isPlayingBack ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4 ml-0.5" />
                )}
              </Button>
              <div className="flex-1 h-1.5 bg-muted/50 rounded-full overflow-hidden relative">
                <div
                  className="absolute inset-y-0 left-0 bg-sky-500 rounded-full transition-all duration-100"
                  style={{ width: `${playbackProgress * 100}%` }}
                />
              </div>
              <span className="text-[10px] font-mono w-10 text-right select-none">
                {playbackAudioRef.current?.duration
                  ? formatTime(Math.round(playbackAudioRef.current.currentTime))
                  : "00:00"}
              </span>
            </div>

            {/* Save Name input */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="recording-name">Save As</Label>
              <Input
                id="recording-name"
                value={fileName}
                onChange={(e) => setFileName(e.target.value)}
                placeholder="recording-name.wav"
                className="font-medium"
              />
            </div>
          </div>
        )}

        <DialogFooter className="flex items-center justify-between gap-2 w-full mt-2">
          {status === "idle" && (
            <Button
              onClick={startRecording}
              variant="destructive"
              className="gap-2 text-white font-semibold rounded-xl px-5 h-11"
            >
              <Mic className="h-4 w-4" />
              Record
            </Button>
          )}

          {status === "recording" && (
            <Button
              onClick={stopRecording}
              variant="outline"
              className="gap-2 border border-border/60 font-semibold rounded-xl px-5 h-11 w-full sm:w-auto"
            >
              <Square className="h-4 w-4 fill-white" />
              Stop Recording
            </Button>
          )}

          {status === "stopped" && (
            <div className="flex items-center justify-end gap-2 w-full">
              <Button
                variant="outline"
                onClick={() => setStatus("idle")}
                className="gap-2 rounded-xl h-11"
              >
                <RefreshCw className="h-4 w-4" />
                Discard
              </Button>
              <Button
                onClick={handleSave}
                disabled={isSaving || !fileName.trim()}
                className="gap-2 rounded-xl h-11 bg-primary text-primary-foreground font-semibold"
              >
                <Save className="h-4 w-4" />
                {isSaving ? "Saving..." : "Save Recording"}
              </Button>
            </div>
          )}

          <Button
            variant="ghost"
            onClick={() => handleClose(false)}
            disabled={status === "recording" || isSaving}
            className="rounded-xl h-11"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Browser PCM WAV Encoder Helper
function audioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numOfChan = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // 1 = Raw PCM
  const bitDepth = 16;

  let result: Float32Array;
  if (numOfChan === 2) {
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
  } else {
    result = buffer.getChannelData(0);
  }

  const bufferLen = result.length * 2;
  const wavBuffer = new ArrayBuffer(44 + bufferLen);
  const view = new DataView(wavBuffer);

  /* RIFF identifier */
  writeString(view, 0, "RIFF");
  /* file length */
  view.setUint32(4, 36 + bufferLen, true);
  /* RIFF type */
  writeString(view, 8, "WAVE");
  /* format chunk identifier */
  writeString(view, 12, "fmt ");
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, format, true);
  /* channel count */
  view.setUint16(22, numOfChan, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * numOfChan * (bitDepth / 8), true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, numOfChan * (bitDepth / 8), true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(view, 36, "data");
  /* data chunk length */
  view.setUint32(40, bufferLen, true);

  // Convert float to 16-bit PCM
  floatTo16BitPCM(view, 44, result);

  return wavBuffer;
}

function interleave(inputL: Float32Array, inputR: Float32Array): Float32Array {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);
  let index = 0;
  let inputIndex = 0;

  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
}

function floatTo16BitPCM(
  output: DataView,
  offset: number,
  input: Float32Array,
) {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}
