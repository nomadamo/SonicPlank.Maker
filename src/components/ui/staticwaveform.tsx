"use client";

import React, { useEffect, useRef, useState } from "react";
import { getAudioPeaks } from "@/lib/waveform";
import { cn } from "@/lib/utils";

interface StaticWaveformProps {
  audioUrl: string;
  pixelsPerSecond?: number;
  height?: number;
  className?: string;
  barColor?: string;
  audioDuration?: number;
}

export function StaticWaveform({
  audioUrl,
  pixelsPerSecond = 50,
  height = 80,
  className,
  barColor = "oklch(0.8391 0.0692 2.6681)",
  audioDuration = 0,
}: StaticWaveformProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    const timeoutId = setTimeout(() => {
      const generateWaveform = async () => {
        try {
          // Canvas element device pixel ratio for High-Res (Retina/4K) screens
          const canvas = canvasRef.current;
          if (!canvas) return;

          const ctx = canvas.getContext("2d");
          if (!ctx) return;

          const MAX_CANVAS_WIDTH = 8000;
          let fetchPps = Math.floor(pixelsPerSecond);
          if (audioDuration > 0) {
            const maxPps = MAX_CANVAS_WIDTH / audioDuration;
            if (pixelsPerSecond > maxPps) {
              fetchPps = Math.floor(Math.max(1, maxPps)); // don't go below 1 pps
            }
          }

          const peaks = await getAudioPeaks(audioUrl, fetchPps);

          // Adjust canvas width to match the exact number of peaks generated
          const exactWidth = peaks.length;
          canvas.width = exactWidth;
          canvas.height = height;

          // Clear and draw on Canvas
          ctx.clearRect(0, 0, exactWidth, height);
          ctx.fillStyle = barColor;

          const barWidth = 1;

          peaks.forEach((peak, i) => {
            const x = i * barWidth;
            // Scale peak to canvas height, centered vertically
            const scaledHeight = peak * height * 0.8;
            const y = (height - scaledHeight) / 2;

            ctx.fillRect(x, y, barWidth, scaledHeight);
          });

          if (mounted) setLoading(false);
        } catch (error) {
          console.error("Failed to generate waveform:", error);
          if (mounted) setLoading(false);
        }
      };

      generateWaveform();
    }, 150);

    return () => {
      mounted = false;
      clearTimeout(timeoutId);
    };
  }, [audioUrl, pixelsPerSecond, height, barColor, audioDuration]);

  return (
    <div className={cn("relative flex items-stretch", className)}>
      {loading && (
        <div className="absolute inset-0 flex items-stretch justify-evenly bg-background/50 backdrop-blur-sm">
          <p className="text-xs text-muted-foreground animate-pulse">
            Rendering audio...
          </p>
        </div>
      )}
      <canvas
        ref={canvasRef}
        style={{ height: `${height}px`, width: "100%" }}
        className="mt-2"
      />
    </div>
  );
}
