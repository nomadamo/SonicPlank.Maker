import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeCaptureSource } from "../global";

export interface UseNativePreviewResult {
  sources: NativeCaptureSource[];
  activeSourceIds: string[];
  loadSources: () => Promise<void>;
  startCapture: (sourceIds: string[]) => Promise<void>;
  stopCapture: () => Promise<void>;
  /** Map of off-DOM canvases that receive RGBA frames from the native preview pipe, keyed by sourceId. */
  canvasesRef: React.MutableRefObject<Map<string, HTMLCanvasElement>>;
}

export function useNativePreview(): UseNativePreviewResult {
  const [sources, setSources] = useState<NativeCaptureSource[]>([]);
  const [activeSourceIds, setActiveSourceIds] = useState<string[]>([]);
  const activeSourceIdsRef = useRef<string[]>([]);
  const canvasesRef = useRef<Map<string, HTMLCanvasElement>>(new Map());

  useEffect(() => {
    window.electron.onNativePreviewFrame((sourceId, width, height, data) => {
      if (!activeSourceIdsRef.current.includes(sourceId) && sourceId !== "preview") return;

      let canvas = canvasesRef.current.get(sourceId);
      if (!canvas) {
        canvas = document.createElement("canvas");
        canvasesRef.current.set(sourceId, canvas);
      }

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
      canvasesRef.current.clear();
    };
  }, []);

  const loadSources = useCallback(async () => {
    const list = await window.electron.getPreviewSources();
    setSources(list);
  }, []);

  const startCapture = useCallback(async (sourceIds: string[]) => {
    for (const id of sourceIds) {
      if (!activeSourceIdsRef.current.includes(id)) {
        await window.electron.startPreviewCapture(id);
      }
    }
    setActiveSourceIds(sourceIds);
    activeSourceIdsRef.current = sourceIds;
  }, []);

  const stopCapture = useCallback(async () => {
    for (const id of activeSourceIdsRef.current) {
      await window.electron.stopPreviewCapture(id);
    }
    setActiveSourceIds([]);
    activeSourceIdsRef.current = [];
    canvasesRef.current.clear();
  }, []);

  return { sources, activeSourceIds, loadSources, startCapture, stopCapture, canvasesRef };
}
