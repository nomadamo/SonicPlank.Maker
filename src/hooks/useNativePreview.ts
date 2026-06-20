import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeCaptureSource } from "../global";

export interface UseNativePreviewResult {
  sources: NativeCaptureSource[];
  activeSourceId: string | null;
  loadSources: () => Promise<void>;
  startCapture: (sourceId: string) => Promise<void>;
  stopCapture: () => Promise<void>;
  /** Off-DOM canvas that receives RGBA frames from the native preview pipe. */
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export function useNativePreview(): UseNativePreviewResult {
  const [sources, setSources] = useState<NativeCaptureSource[]>([]);
  const [activeSourceId, setActiveSourceId] = useState<string | null>(null);
  const activeSourceIdRef = useRef<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    canvasRef.current = document.createElement("canvas");

    window.electron.onNativePreviewFrame((sourceId, width, height, data) => {
      if (sourceId !== activeSourceIdRef.current) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      // Rust converts BGRA→RGBA before sending; pass directly as RGBA.
      const rgba = new Uint8ClampedArray(data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
      ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
    });

    return () => {
      window.electron.removeOnNativePreviewFrame();
      canvasRef.current = null;
    };
  }, []);

  const loadSources = useCallback(async () => {
    const list = await window.electron.getPreviewSources();
    setSources(list);
  }, []);

  const startCapture = useCallback(async (sourceId: string) => {
    await window.electron.startPreviewCapture(sourceId);
    setActiveSourceId(sourceId);
    activeSourceIdRef.current = sourceId;
  }, []);

  const stopCapture = useCallback(async () => {
    if (activeSourceIdRef.current) {
      await window.electron.stopPreviewCapture(activeSourceIdRef.current);
      setActiveSourceId(null);
      activeSourceIdRef.current = null;
    }
  }, []);

  return { sources, activeSourceId, loadSources, startCapture, stopCapture, canvasRef };
}
