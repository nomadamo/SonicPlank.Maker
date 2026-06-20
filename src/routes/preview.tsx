import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2, Lock, Unlock } from "lucide-react";
import { OverlayElement } from "@/types/flow-node";

export const Route = createFileRoute("/preview")({
  validateSearch: (search: Record<string, unknown>): { aspect: string } => ({
    aspect: typeof search.aspect === "string" ? search.aspect : "16/9",
  }),
  component: PreviewComponent,
});

function PreviewComponent() {
  const { aspect } = Route.useSearch() as unknown as { aspect: string };
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // True once the first compositor frame arrives via IPC from the editor
  const [hasFrame, setHasFrame] = useState(false);
  const hasFrameRef = useRef(false);
  const [dynamicAspect, setDynamicAspect] = useState<string>(aspect);

  const [overlays, setOverlays] = useState<OverlayElement[]>([]);

  // Draggable overlays state & refs
  const [isLocked, setIsLocked] = useState(true);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const dragStartRef = useRef<{
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  }>({ offsetX: 0, offsetY: 0, width: 0, height: 0 });

  // Resizable overlays
  const [activeResizeId, setActiveResizeId] = useState<string | null>(null);
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const resizeStartRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    clickX: number;
    clickY: number;
    aspectRatio: number;
  }>({ x: 0, y: 0, width: 0, height: 0, clickX: 0, clickY: 0, aspectRatio: 1 });

  const handleMouseDown = (e: React.MouseEvent, overlay: OverlayElement) => {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * 100;
    const clickY = ((e.clientY - rect.top) / rect.height) * 100;
    dragStartRef.current = {
      offsetX: clickX - overlay.x,
      offsetY: clickY - overlay.y,
      width: overlay.width,
      height: overlay.height,
    };
    setActiveDragId(overlay.id);
  };

  const handleResizeMouseDown = (
    e: React.MouseEvent,
    overlay: OverlayElement,
    handle: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * 100;
    const clickY = ((e.clientY - rect.top) / rect.height) * 100;
    resizeStartRef.current = {
      x: overlay.x,
      y: overlay.y,
      width: overlay.width,
      height: overlay.height,
      clickX,
      clickY,
      aspectRatio: overlay.width / (overlay.height || 1),
    };
    setActiveResizeId(overlay.id);
    setActiveHandle(handle);
  };

  useEffect(() => {
    if (!activeDragId) return;
    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const currentX = ((e.clientX - rect.left) / rect.width) * 100;
      const currentY = ((e.clientY - rect.top) / rect.height) * 100;
      const start = dragStartRef.current;
      let newX = currentX - start.offsetX;
      let newY = currentY - start.offsetY;
      newX = Math.max(0, Math.min(100 - start.width, newX));
      newY = Math.max(0, Math.min(100 - start.height, newY));
      newX = Math.round(newX * 10) / 10;
      newY = Math.round(newY * 10) / 10;
      setOverlays((prev) =>
        prev.map((o) => (o.id === activeDragId ? { ...o, x: newX, y: newY } : o)),
      );
    };
    const handleMouseUp = () => setActiveDragId(null);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [activeDragId]);

  useEffect(() => {
    if (!activeResizeId || !activeHandle) return;
    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const currentX = ((e.clientX - rect.left) / rect.width) * 100;
      const currentY = ((e.clientY - rect.top) / rect.height) * 100;
      const start = resizeStartRef.current;
      const dx = currentX - start.clickX;
      const dy = currentY - start.clickY;
      let newX = start.x;
      let newY = start.y;
      let newWidth = start.width;
      let newHeight = start.height;
      const R = start.aspectRatio;
      const maintainAspect = e.ctrlKey;
      switch (activeHandle) {
        case "r": newWidth = start.width + dx; if (maintainAspect) newHeight = newWidth / R; break;
        case "l": newWidth = start.width - dx; if (maintainAspect) newHeight = newWidth / R; newX = start.x + (start.width - newWidth); break;
        case "b": newHeight = start.height + dy; if (maintainAspect) newWidth = newHeight * R; break;
        case "t": newHeight = start.height - dy; if (maintainAspect) newWidth = newHeight * R; newY = start.y + (start.height - newHeight); break;
        case "br": newWidth = start.width + dx; newHeight = start.height + dy; if (maintainAspect) { if (Math.abs(dx) > Math.abs(dy)) newHeight = newWidth / R; else newWidth = newHeight * R; } break;
        case "bl": newWidth = start.width - dx; newHeight = start.height + dy; if (maintainAspect) { if (Math.abs(dx) > Math.abs(dy)) newHeight = newWidth / R; else newWidth = newHeight * R; } newX = start.x + (start.width - newWidth); break;
        case "tr": newWidth = start.width + dx; newHeight = start.height - dy; if (maintainAspect) { if (Math.abs(dx) > Math.abs(dy)) newHeight = newWidth / R; else newWidth = newHeight * R; } newY = start.y + (start.height - newHeight); break;
        case "tl": newWidth = start.width - dx; newHeight = start.height - dy; if (maintainAspect) { if (Math.abs(dx) > Math.abs(dy)) newHeight = newWidth / R; else newWidth = newHeight * R; } newX = start.x + (start.width - newWidth); newY = start.y + (start.height - newHeight); break;
      }
      const minSize = 2;
      if (newWidth < minSize) { if (["l","bl","tl"].includes(activeHandle)) newX = start.x + start.width - minSize; newWidth = minSize; if (maintainAspect) newHeight = minSize / R; }
      if (newHeight < minSize) { if (["t","tr","tl"].includes(activeHandle)) newY = start.y + start.height - minSize; newHeight = minSize; if (maintainAspect) newWidth = minSize * R; }
      if (newX < 0) { newWidth = newWidth + newX; newX = 0; if (maintainAspect) newHeight = newWidth / R; }
      if (newY < 0) { newHeight = newHeight + newY; newY = 0; if (maintainAspect) newWidth = newHeight * R; }
      if (newX + newWidth > 100) { newWidth = 100 - newX; if (maintainAspect) newHeight = newWidth / R; }
      if (newY + newHeight > 100) { newHeight = 100 - newY; if (maintainAspect) newWidth = newHeight * R; }
      newX = Math.round(newX * 10) / 10;
      newY = Math.round(newY * 10) / 10;
      newWidth = Math.round(newWidth * 10) / 10;
      newHeight = Math.round(newHeight * 10) / 10;
      setOverlays((prev) =>
        prev.map((o) =>
          o.id === activeResizeId ? { ...o, x: newX, y: newY, width: newWidth, height: newHeight } : o,
        ),
      );
    };
    const handleMouseUp = () => { setActiveResizeId(null); setActiveHandle(null); };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [activeResizeId, activeHandle]);

  const toggleLocked = () => {
    if (!isLocked) window.electron.setOverlays(overlays).catch(() => {});
    setIsLocked((prev) => !prev);
  };

  // Audio analyser data from editor (via IPC broadcast)
  const audioDataMapRef = useRef<Record<string, number[]>>({});
  const audioTimesRef = useRef<Record<string, { currentTime: number; duration: number }>>({});

  // Subscribe to overlay updates from main process
  useEffect(() => {
    window.electron.getOverlays()
      .then((initial) => { if (initial) setOverlays(initial); })
      .catch(() => {});
    window.electron.onOverlaysUpdated((updated) => setOverlays(updated ?? []));
    return () => { window.electron.removeOnOverlaysUpdated(() => {}); };
  }, []);

  // Subscribe to audio data and time updates
  useEffect(() => {
    window.electron.onAudioDataUpdated((id, data) => { audioDataMapRef.current[id] = data; });
    return () => { window.electron.removeOnAudioDataUpdated(); };
  }, []);

  useEffect(() => {
    window.electron.onAudioTimeUpdated((nodeId, currentTime) => {
      const overlay = overlays.find((o) => o.audioNodeId === nodeId && o.type === "nowPlaying");
      const duration = overlay?.duration !== undefined ? Number(overlay.duration) : 0;
      audioTimesRef.current[nodeId] = { currentTime, duration };
    });
    return () => { window.electron.removeOnAudioTimeUpdated(); };
  }, [overlays]);

  // Load theme styles
  useEffect(() => {
    window.electron.getAvailableThemes()
      .then((themes) => {
        const theme = themes.find((t) => t.id === "default") ?? themes[0];
        if (!theme) return;
        return window.electron.loadThemeStyles(theme.id as string);
      })
      .then((styles) => {
        if (!styles) return;
        let tag = document.getElementById("preview-theme-styles");
        if (!tag) { tag = document.createElement("style"); tag.id = "preview-theme-styles"; document.head.appendChild(tag); }
        tag.textContent = styles;
      })
      .catch(() => {});
  }, []);

  // Receive composited JPEG frames from the editor compositor via MessagePort.
  // These carry overlays already rendered — unlike onNativePreviewFrame which
  // delivers raw unprocessed capture pixels with no overlay content.
  useEffect(() => {
    window.electron.onPreviewFrame((data: ArrayBuffer, width: number, height: number) => {
      if (!hasFrameRef.current) {
        hasFrameRef.current = true;
        if (width > 0 && height > 0) setDynamicAspect(`${width}/${height}`);
        (window.electron.notifyEditOverlayConnected as () => void)();
        setHasFrame(true);
      }

      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
      if (!ctx) return;

      const blob = new Blob([data], { type: "image/jpeg" });
      createImageBitmap(blob)
        .then((bmp) => {
          canvas.width = bmp.width;
          canvas.height = bmp.height;
          ctx.drawImage(bmp, 0, 0);
          bmp.close();
        })
        .catch(() => {});
    });
    return () => { window.electron.removeOnPreviewFrame(); };
  }, []);

  const aspectValue = aspect === "auto" ? dynamicAspect : aspect;

  return (
    <div className="relative w-screen h-screen bg-black flex flex-col items-center justify-center overflow-hidden select-none group">
      {hasFrame ? (
        <div
          ref={containerRef}
          className="relative max-w-full max-h-full animate-fade-in"
          style={{ aspectRatio: aspectValue }}
        >
          <canvas ref={canvasRef} className="w-full h-full block" />

          {/* Draggable overlay handles when unlocked */}
          {!isLocked && (
            <div className="absolute inset-0 z-50 pointer-events-none">
              {overlays.map((overlay) => (
                <div
                  key={overlay.id}
                  onMouseDown={(e) => handleMouseDown(e, overlay)}
                  className="absolute pointer-events-auto border-2 border-dashed border-indigo-500 bg-indigo-500/10 cursor-move rounded flex flex-col justify-between p-1.5 select-none hover:bg-indigo-500/20 hover:border-indigo-400 transition-colors"
                  style={{
                    left: `${overlay.x}%`,
                    top: `${overlay.y}%`,
                    width: `${overlay.width}%`,
                    height: `${overlay.height}%`,
                  }}
                >
                  <div className="bg-indigo-600/90 backdrop-blur-sm text-[9px] font-bold text-white px-1.5 py-0.5 rounded shadow self-start uppercase tracking-wider font-mono">
                    {overlay.type?.replace("OverlayNode", "").replace("Node", "") ?? overlay.type}
                  </div>
                  <div className="text-[9px] text-indigo-200 bg-zinc-950/80 px-1 py-0.5 rounded self-end font-mono">
                    {overlay.x}%, {overlay.y}%
                  </div>

                  {/* Corner handles */}
                  {(["tl","tr","bl","br"] as const).map((h) => (
                    <div key={h} onMouseDown={(e) => handleResizeMouseDown(e, overlay, h)}
                      className="absolute w-2.5 h-2.5 bg-white border-2 border-indigo-600 rounded-full shadow z-50 hover:bg-indigo-400"
                      style={{
                        cursor: h === "tl" || h === "br" ? "nwse-resize" : "nesw-resize",
                        top: h.startsWith("t") ? "-5px" : undefined,
                        bottom: h.startsWith("b") ? "-5px" : undefined,
                        left: h.endsWith("l") ? "-5px" : undefined,
                        right: h.endsWith("r") ? "-5px" : undefined,
                      }}
                    />
                  ))}

                  {/* Side handles */}
                  <div onMouseDown={(e) => handleResizeMouseDown(e, overlay, "t")} className="absolute w-2.5 h-2.5 bg-white border-2 border-indigo-600 rounded-full shadow z-50 hover:bg-indigo-400 cursor-ns-resize" style={{ top: "-5px", left: "50%", transform: "translateX(-50%)" }} />
                  <div onMouseDown={(e) => handleResizeMouseDown(e, overlay, "b")} className="absolute w-2.5 h-2.5 bg-white border-2 border-indigo-600 rounded-full shadow z-50 hover:bg-indigo-400 cursor-ns-resize" style={{ bottom: "-5px", left: "50%", transform: "translateX(-50%)" }} />
                  <div onMouseDown={(e) => handleResizeMouseDown(e, overlay, "l")} className="absolute w-2.5 h-2.5 bg-white border-2 border-indigo-600 rounded-full shadow z-50 hover:bg-indigo-400 cursor-ew-resize" style={{ top: "50%", left: "-5px", transform: "translateY(-50%)" }} />
                  <div onMouseDown={(e) => handleResizeMouseDown(e, overlay, "r")} className="absolute w-2.5 h-2.5 bg-white border-2 border-indigo-600 rounded-full shadow z-50 hover:bg-indigo-400 cursor-ew-resize" style={{ top: "50%", right: "-5px", transform: "translateY(-50%)" }} />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-zinc-400 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <span className="text-sm font-medium tracking-wide">Connecting to Compositor...</span>
          <span className="text-xs text-zinc-600 max-w-xs">
            Waiting for the editor to send frames. Ensure a capture source is selected and the output node is active.
          </span>
        </div>
      )}

      {/* Floating control bar — overlay editing only */}
      {hasFrame && (
        <div
          style={{ zIndex: 10000 }}
          className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-zinc-950/80 backdrop-blur-md px-4 py-2.5 rounded-full border border-zinc-800 shadow-2xl transition-all duration-300 ${
            !isLocked
              ? "opacity-100 border-indigo-500/50 shadow-[0_0_20px_rgba(99,102,241,0.2)]"
              : "opacity-0 hover:opacity-100 group-hover:opacity-100"
          }`}
        >
          <button
            onClick={toggleLocked}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider cursor-pointer border transition-all ${
              !isLocked
                ? "bg-indigo-600 text-white border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)] hover:bg-indigo-500"
                : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-white"
            }`}
          >
            {!isLocked ? <><Unlock className="w-3.5 h-3.5" /> Lock Layout</> : <><Lock className="w-3.5 h-3.5" /> Move Overlays</>}
          </button>
        </div>
      )}
    </div>
  );
}
