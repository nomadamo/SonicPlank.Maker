import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { useScreenCapture } from "@/hooks/useScreenCapture";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/preview")({
  validateSearch: (search: Record<string, unknown>) => {
    return {
      sourceId: (search.sourceId as string) || "",
      audio: (search.audio as string) || "false",
      resolution: (search.resolution as string) || "original",
    };
  },
  component: PreviewComponent,
});

const RESOLUTION_PRESETS = {
  original: { aspect: "auto", width: 3840, height: 2160 },
  hd: { aspect: "16/9", width: 1280, height: 720 },
  fhd: { aspect: "16/9", width: 1920, height: 1080 },
  uwhd: { aspect: "21/9", width: 2560, height: 1080 },
  uwqhd: { aspect: "21/9", width: 3440, height: 1440 },
};

function PreviewComponent() {
  const { sourceId, audio, resolution } = Route.useSearch();
  const captureAudio = audio === "true";
  const videoRef = useRef<HTMLVideoElement>(null);
  const [dynamicAspectRatio, setDynamicAspectRatio] = useState<string>("16/9");

  const { stream, startCapture, stopCapture } = useScreenCapture();

  const presetKey = (resolution as keyof typeof RESOLUTION_PRESETS) || "original";
  const activePreset = RESOLUTION_PRESETS[presetKey] || RESOLUTION_PRESETS.original;

  useEffect(() => {
    if (sourceId) {
      console.log(`[PreviewWindow] Starting capture for sourceId: ${sourceId}, audio: ${captureAudio}, resolution: ${presetKey}`);
      startCapture(sourceId, captureAudio, { maxWidth: activePreset.width, maxHeight: activePreset.height });
    }
    return () => {
      console.log("[PreviewWindow] Stopping capture tracks.");
      stopCapture();
    };
  }, [sourceId, captureAudio, startCapture, stopCapture, activePreset, presetKey]);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch((err) => {
        console.error("[PreviewWindow] Failed to play media stream:", err);
      });
    }
  }, [stream]);

  const handleVideoLoadedMetadata = useCallback((e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    if (video.videoWidth && video.videoHeight) {
      setDynamicAspectRatio(`${video.videoWidth}/${video.videoHeight}`);
    }
  }, []);

  return (
    <div className="w-screen h-screen bg-black flex flex-col items-center justify-center overflow-hidden select-none">
      {stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={handleVideoLoadedMetadata}
          className="max-w-full max-h-full object-contain"
          style={{
            aspectRatio: activePreset.aspect === "auto" ? dynamicAspectRatio : activePreset.aspect,
          }}
        />
      ) : (
        <div className="flex flex-col items-center gap-3 text-zinc-400 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <span className="text-sm font-medium tracking-wide">Connecting to Screen Capture...</span>
          <span className="text-xs text-zinc-600">Initialising desktop audio and video pipeline</span>
        </div>
      )}
    </div>
  );
}
