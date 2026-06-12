import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { useScreenCapture } from "@/hooks/useScreenCapture";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/preview")({
  validateSearch: (search: Record<string, unknown>) => {
    return {
      sourceId: (search.sourceId as string) || "",
      audio: (search.audio as string) || "false",
      maxWidth: search.maxWidth ? Number(search.maxWidth) : undefined,
      maxHeight: search.maxHeight ? Number(search.maxHeight) : undefined,
      aspect: (search.aspect as string) || "auto",
    };
  },
  component: PreviewComponent,
});

function PreviewComponent() {
  const { sourceId, audio, maxWidth, maxHeight, aspect } = Route.useSearch();
  const captureAudio = audio === "true";
  const videoRef = useRef<HTMLVideoElement>(null);
  const [dynamicAspectRatio, setDynamicAspectRatio] = useState<string>("16/9");

  const { stream, startCapture, stopCapture } = useScreenCapture();

  useEffect(() => {
    if (sourceId) {
      console.log(`[PreviewWindow] Starting capture for sourceId: ${sourceId}, audio: ${captureAudio}, bounds: ${maxWidth}x${maxHeight}`);
      startCapture(sourceId, captureAudio, { maxWidth, maxHeight });
    }
    return () => {
      console.log("[PreviewWindow] Stopping capture tracks.");
      stopCapture();
    };
  }, [sourceId, captureAudio, startCapture, stopCapture, maxWidth, maxHeight]);

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
            aspectRatio: aspect === "auto" ? dynamicAspectRatio : aspect,
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
