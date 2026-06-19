import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeCaptureSource } from "../global";

export interface UseNativePreviewResult {
  sources: NativeCaptureSource[];
  activeSourceId: string | null;
  loadSources: () => Promise<void>;
  startCapture: (sourceId: string) => Promise<void>;
  stopCapture: () => Promise<void>;
  /** Attach to a <canvas> element to receive live BGRA frames. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export function useNativePreview(): UseNativePreviewResult {
  const [sources, setSources] = useState<NativeCaptureSource[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    window.electron.onNativePreviewFrame((data, width, height) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // BGRA → RGBA: swap B and R channels in-place on a copy.
      const rgba = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
      const swapped = new Uint8ClampedArray(rgba.length);
      for (let i = 0; i < rgba.length; i += 4) {
        swapped[i] = rgba[i + 2]; // R ← B
        swapped[i + 1] = rgba[i + 1]; // G
        swapped[i + 2] = rgba[i]; // B ← R
        swapped[i + 3] = rgba[i + 3]; // A
      }
      ctx.putImageData(new ImageData(swapped, width, height), 0, 0);
    });

    return () => {
      window.electron.removeOnNativePreviewFrame();
    };
  }, []);

  const loadSources = useCallback(async () => {
    const list = await window.electron.getPreviewSources();
    setSources(list);
  }, []);

  const startCapture = useCallback(async (sourceId: string) => {
    await window.electron.startPreviewCapture(sourceId);
    setActiveSourceId(sourceId);
  }, []);

  const stopCapture = useCallback(async () => {
    await window.electron.stopPreviewCapture();
    setActiveSourceId(null);
  }, []);

  return { sources, activeSourceId, loadSources, startCapture, stopCapture, canvasRef };
}
