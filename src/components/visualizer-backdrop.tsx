import { useState, useMemo, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { useAudio } from "@/hooks/use-audio";
import { Mixed8 } from "waviz";

export function VisualizerBackdrop({ visible }: { visible: boolean }) {
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
