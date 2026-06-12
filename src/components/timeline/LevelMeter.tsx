import { useEffect, useRef } from "react";
import { getTrackAnalyser } from "@/lib/trackAudioRegistry";

interface LevelMeterProps {
  trackId: string;
}

export function LevelMeter({ trackId }: LevelMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | null>(null);
  const levelRef = useRef({ rms: 0, peak: 0, peakHold: 0, peakHoldTime: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Handle high DPI displays
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const render = () => {
      const analyser = getTrackAnalyser(trackId);
      let rms = 0;
      let peak = 0;

      if (analyser) {
        const bufferLength = analyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);
        analyser.getByteTimeDomainData(dataArray);

        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          // normalize sample value to range [-1.0, 1.0]
          const val = (dataArray[i] - 128) / 128;
          sum += val * val;
          const absVal = Math.abs(val);
          if (absVal > peak) {
            peak = absVal;
          }
        }
        rms = Math.sqrt(sum / bufferLength);
      }

      // Smooth decay calculations
      const state = levelRef.current;

      // Smooth RMS decay
      state.rms = state.rms * 0.8 + rms * 0.2;

      // Peak decay
      if (peak > state.peak) {
        state.peak = peak;
      } else {
        state.peak = state.peak * 0.92;
      }

      // Peak hold logic
      if (peak > state.peakHold) {
        state.peakHold = peak;
        state.peakHoldTime = 30; // hold for 30 frames (~500ms)
      } else {
        if (state.peakHoldTime > 0) {
          state.peakHoldTime--;
        } else {
          state.peakHold = state.peakHold * 0.95;
        }
      }

      // Render the level meter graphics
      const w = rect.width;
      const h = rect.height;
      ctx.clearRect(0, 0, w, h);

      // Draw background
      ctx.fillStyle = "rgba(10, 10, 12, 0.6)";
      ctx.fillRect(0, 0, w, h);

      // Map level values to drawing heights
      const rmsHeight = state.rms * h * 1.5; // Scale slightly for visual prominence
      const peakHeight = state.peak * h * 1.5;
      const peakHoldY = h - (state.peakHold * h * 1.5);

      // Create vertical green-yellow-red gradient
      const grad = ctx.createLinearGradient(0, h, 0, 0);
      grad.addColorStop(0, "#22c55e");     // Green (low levels)
      grad.addColorStop(0.65, "#eab308");  // Yellow (nominal level warning)
      grad.addColorStop(0.9, "#ef4444");   // Red (clipping threshold)

      // Draw RMS bar
      ctx.fillStyle = grad;
      ctx.fillRect(0, h - Math.min(h, rmsHeight), w, Math.min(h, rmsHeight));

      // Draw translucent Peak overlay
      ctx.fillStyle = grad;
      ctx.globalAlpha = 0.45;
      ctx.fillRect(0, h - Math.min(h, peakHeight), w, Math.min(h, peakHeight));
      ctx.globalAlpha = 1.0;

      // Draw Peak Hold indicator
      if (state.peakHold > 0.005) {
        const lineY = Math.max(0, Math.min(h - 2, peakHoldY));
        ctx.fillStyle = state.peakHold > 0.8 ? "#ef4444" : "#f4f4f5";
        ctx.fillRect(0, lineY, w, 1.5);
      }

      // Draw subtle scale ticks (e.g. dB scale markers)
      ctx.strokeStyle = "rgba(255, 255, 255, 0.07)";
      ctx.lineWidth = 1;
      const tickSteps = 5;
      for (let i = 1; i < tickSteps; i++) {
        const y = (i / tickSteps) * h;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [trackId]);

  return (
    <div className="w-2.5 h-full relative bg-background/80 rounded-sm overflow-hidden border border-border/40 shrink-0">
      <canvas ref={canvasRef} className="w-full h-full block" />
    </div>
  );
}
