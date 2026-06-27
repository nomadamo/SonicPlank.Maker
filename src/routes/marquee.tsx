import { AnimatedRoute } from "@/components/animated-route";
import { LoadingAnimation } from "@/components/animations/loading-animation";
import { CustomColorPicker } from "@/components/ui/custom-color-picker";
import {
  SortableDragHandle,
  SortableItem,
  SortableList,
} from "@/components/ui/sortable-list";
import {
  ComponentStyleProps,
  OverlayThemeComponent,
  OverlayThemeElement,
  OverlayThemeVariable,
} from "@/types/flow-node";
import { ComponentPreviewCanvas } from "@/components/marquee/component-preview-canvas";
import { createFileRoute } from "@tanstack/react-router";
import {
  BarChart2,
  FolderOpen,
  ImagePlus,
  MessageSquare,
  Music,
  Plus,
  Redo2,
  Save,
  Square,
  Trash2,
  Type,
  Undo2,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

const fileBasename = (p: string) =>
  p.replace(/\\/g, "/").split("/").pop() ?? p;

export const Route = createFileRoute("/marquee")({
  component: Marquee,
  pendingComponent: LoadingAnimation,
});

// ─── Types & constants ────────────────────────────────────────────────────────

interface ThemeMeta {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
}

const DEFAULT_META: ThemeMeta = {
  id: crypto.randomUUID(),
  name: "Untitled Theme",
  author: "",
  version: "1.0.0",
  description: "",
};

const HANDLE_CURSORS: Record<string, string> = {
  tl: "nwse-resize",
  tr: "nesw-resize",
  bl: "nesw-resize",
  br: "nwse-resize",
  t: "ns-resize",
  b: "ns-resize",
  l: "ew-resize",
  r: "ew-resize",
};

type CompType = OverlayThemeComponent["componentType"];

interface CompTypeMeta {
  label: string;
  borderColor: string;
  bgColor: string;
  textColor: string;
  defaultWidth: number;
  defaultHeight: number;
  defaultStyle: ComponentStyleProps;
}

const COMP_META: Record<CompType, CompTypeMeta> = {
  text: {
    label: "Text",
    borderColor: "border-amber-500/60",
    bgColor: "bg-amber-950/30",
    textColor: "text-amber-300",
    defaultWidth: 35,
    defaultHeight: 8,
    defaultStyle: { textContent: "Text Overlay", fontSize: 5, textColor: "#ffffff", fontFamily: "sans-serif", fontWeight: "normal", fontStyle: "normal" },
  },
  color: {
    label: "Color",
    borderColor: "border-purple-500/60",
    bgColor: "bg-purple-950/30",
    textColor: "text-purple-300",
    defaultWidth: 30,
    defaultHeight: 15,
    defaultStyle: { backgroundColor: "#4f46e5" },
  },
  image: {
    label: "Image",
    borderColor: "border-sky-500/60",
    bgColor: "bg-sky-950/30",
    textColor: "text-sky-300",
    defaultWidth: 25,
    defaultHeight: 20,
    defaultStyle: {},
  },
  visualizer: {
    label: "Visualizer",
    borderColor: "border-green-500/60",
    bgColor: "bg-green-950/30",
    textColor: "text-green-300",
    defaultWidth: 40,
    defaultHeight: 15,
    defaultStyle: { visualizerType: "bars", backgroundColor: "rgba(0,0,0,0.3)", barColor: "#6366f1" },
  },
  nowPlaying: {
    label: "Now Playing",
    borderColor: "border-rose-500/60",
    bgColor: "bg-rose-950/30",
    textColor: "text-rose-300",
    defaultWidth: 35,
    defaultHeight: 18,
    defaultStyle: { backgroundColor: "rgba(0,0,0,0.6)", textColor: "#ffffff", progressColor: "#6366f1", fontFamily: "sans-serif" },
  },
  twitchChat: {
    label: "Chat",
    borderColor: "border-cyan-500/60",
    bgColor: "bg-cyan-950/30",
    textColor: "text-cyan-300",
    defaultWidth: 28,
    defaultHeight: 40,
    defaultStyle: { backgroundColor: "rgba(0,0,0,0.5)", textColor: "#ffffff", fontSize: 2.5, fontFamily: "sans-serif", fontWeight: "normal", fontStyle: "normal", maxMessages: 10 },
  },
};

function compTypeIcon(type: CompType, className = "w-3 h-3 shrink-0") {
  if (type === "text")       return <Type         className={`${className} text-amber-400`} />;
  if (type === "color")      return <Square       className={`${className} text-purple-400`} />;
  if (type === "image")      return <ImagePlus    className={`${className} text-sky-400`} />;
  if (type === "visualizer") return <BarChart2    className={`${className} text-green-400`} />;
  if (type === "nowPlaying") return <Music        className={`${className} text-rose-400`} />;
  return                            <MessageSquare className={`${className} text-cyan-400`} />;
}

function newElement(
  type: OverlayThemeElement["type"],
  extra: Partial<OverlayThemeElement> = {},
): OverlayThemeElement {
  return { id: crypto.randomUUID(), type, x: 35, y: 35, width: 30, height: 20, opacity: 1, ...extra };
}

function newComponent(type: CompType): OverlayThemeComponent {
  const m = COMP_META[type];
  return {
    id: crypto.randomUUID(),
    componentType: type,
    x: 35, y: 35,
    width: m.defaultWidth,
    height: m.defaultHeight,
    opacity: 1,
    styleProps: { ...m.defaultStyle },
    decorations: [],
  };
}

// ─── Resize handle render helper ──────────────────────────────────────────────

function ResizeHandles({ onMouseDown }: { onMouseDown: (e: React.MouseEvent, h: string) => void }) {
  return (
    <>
      {(["tl","tr","bl","br","t","b","l","r"] as const).map((h) => {
        const style: React.CSSProperties = { cursor: HANDLE_CURSORS[h], position: "absolute" };
        if (h.startsWith("t")) style.top = -5;
        if (h.startsWith("b")) style.bottom = -5;
        if (h.endsWith("l"))   style.left = -5;
        if (h.endsWith("r"))   style.right = -5;
        if (h === "t" || h === "b") { style.left = "50%"; style.transform = "translateX(-50%)"; }
        if (h === "l" || h === "r") { style.top  = "50%"; style.transform = "translateY(-50%)"; }
        return (
          <div
            key={h}
            onMouseDown={(e) => onMouseDown(e, h)}
            className="w-2.5 h-2.5 bg-white border-2 border-violet-500 rounded-full shadow z-50 hover:bg-violet-300"
            style={style}
          />
        );
      })}
    </>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

function Marquee() {
  const [meta, setMeta] = useState<ThemeMeta>(DEFAULT_META);
  const [elements, setElements] = useState<OverlayThemeElement[]>([]);
  const [components, setComponents] = useState<OverlayThemeComponent[]>([]);
  const [variables, setVariables] = useState<OverlayThemeVariable[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [focusedComponentId, setFocusedComponentId] = useState<string | null>(null);
  const [focusedDraftComp, setFocusedDraftComp] = useState<OverlayThemeComponent | null>(null);
  const [focusedSelectedDecId, setFocusedSelectedDecId] = useState<string | null>(null);
  // maps element.asset (relative name) → absolute local file:// URL
  const [assetPaths, setAssetPaths] = useState<Record<string, string>>({});
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const focusedCanvasRef = useRef<HTMLDivElement | null>(null);

  const selectedEl   = elements.find((e) => e.id === selectedId) ?? null;
  const selectedComp = components.find((c) => c.id === selectedId) ?? null;

  // ─── Unified drag/resize refs ─────────────────────────────────────────────
  const activeDragId     = useRef<string | null>(null);
  const activeDragSource = useRef<"element" | "component" | "decoration" | null>(null);
  const dragStart        = useRef({ offsetX: 0, offsetY: 0, width: 0, height: 0 });

  const activeResizeId     = useRef<string | null>(null);
  const activeResizeSource = useRef<"element" | "component" | "decoration" | null>(null);
  const activeHandle       = useRef<string | null>(null);
  const resizeStart        = useRef({ x: 0, y: 0, width: 0, height: 0, clickX: 0, clickY: 0, aspectRatio: 1 });

  const [, forceRender] = useState(0);

  // ─── Undo / Redo ─────────────────────────────────────────────────────────
  type HistoryEntry = { elements: OverlayThemeElement[]; components: OverlayThemeComponent[] };
  const historyRef      = useRef<HistoryEntry[]>([{ elements: [], components: [] }]);
  const historyIdxRef   = useRef(0);
  const suppressHistRef = useRef(false);
  const histTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Always-current refs so the mouseup closure can read the latest values.
  const elementsRef     = useRef(elements);  elementsRef.current   = elements;
  const componentsRef   = useRef(components); componentsRef.current = components;
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  const pushHistory = useCallback((elems: OverlayThemeElement[], comps: OverlayThemeComponent[]) => {
    historyRef.current = [...historyRef.current.slice(0, historyIdxRef.current + 1), { elements: elems, components: comps }];
    historyIdxRef.current = historyRef.current.length - 1;
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(false);
  }, []);

  const undo = useCallback(() => {
    if (historyIdxRef.current <= 0) return;
    if (histTimerRef.current) clearTimeout(histTimerRef.current);
    suppressHistRef.current = true;
    historyIdxRef.current--;
    const snap = historyRef.current[historyIdxRef.current];
    setElements(snap.elements);
    setComponents(snap.components);
    setCanUndo(historyIdxRef.current > 0);
    setCanRedo(true);
  }, []);

  const redo = useCallback(() => {
    if (historyIdxRef.current >= historyRef.current.length - 1) return;
    if (histTimerRef.current) clearTimeout(histTimerRef.current);
    suppressHistRef.current = true;
    historyIdxRef.current++;
    const snap = historyRef.current[historyIdxRef.current];
    setElements(snap.elements);
    setComponents(snap.components);
    setCanUndo(true);
    setCanRedo(historyIdxRef.current < historyRef.current.length - 1);
  }, []);

  const pct = useCallback((e: MouseEvent) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
  }, []);

  const pctFocused = useCallback((e: MouseEvent) => {
    const rect = focusedCanvasRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    };
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (activeDragId.current) {
        const src = activeDragSource.current;
        const { x, y } = src === "decoration" ? pctFocused(e) : pct(e);
        const s = dragStart.current;
        const newX = Math.round(Math.max(0, Math.min(100 - s.width, x - s.offsetX)) * 10) / 10;
        const newY = Math.round(Math.max(0, Math.min(100 - s.height, y - s.offsetY)) * 10) / 10;
        if (src === "element") {
          setElements((prev) => prev.map((el) => el.id === activeDragId.current ? { ...el, x: newX, y: newY } : el));
        } else if (src === "component") {
          setComponents((prev) => prev.map((c) => c.id === activeDragId.current ? { ...c, x: newX, y: newY } : c));
        } else if (src === "decoration") {
          setFocusedDraftComp((prev) => !prev ? prev : { ...prev, decorations: prev.decorations.map((d) => d.id === activeDragId.current ? { ...d, x: newX, y: newY } : d) });
        }
        return;
      }

      if (activeResizeId.current && activeHandle.current) {
        const src = activeResizeSource.current;
        const { x: curX, y: curY } = src === "decoration" ? pctFocused(e) : pct(e);
        const s = resizeStart.current;
        const h = activeHandle.current;
        const dx = curX - s.clickX;
        const dy = curY - s.clickY;
        const R = s.aspectRatio;
        const lock = e.ctrlKey;
        let nx = s.x, ny = s.y, nw = s.width, nh = s.height;

        switch (h) {
          case "r":  nw = s.width + dx;  if (lock) nh = nw / R; break;
          case "l":  nw = s.width - dx;  if (lock) nh = nw / R; nx = s.x + (s.width - nw); break;
          case "b":  nh = s.height + dy; if (lock) nw = nh * R; break;
          case "t":  nh = s.height - dy; if (lock) nw = nh * R; ny = s.y + (s.height - nh); break;
          case "br": nw = s.width + dx;  nh = s.height + dy; if (lock) { Math.abs(dx) > Math.abs(dy) ? (nh = nw / R) : (nw = nh * R); } break;
          case "bl": nw = s.width - dx;  nh = s.height + dy; if (lock) { Math.abs(dx) > Math.abs(dy) ? (nh = nw / R) : (nw = nh * R); } nx = s.x + (s.width - nw); break;
          case "tr": nw = s.width + dx;  nh = s.height - dy; if (lock) { Math.abs(dx) > Math.abs(dy) ? (nh = nw / R) : (nw = nh * R); } ny = s.y + (s.height - nh); break;
          case "tl": nw = s.width - dx;  nh = s.height - dy; if (lock) { Math.abs(dx) > Math.abs(dy) ? (nh = nw / R) : (nw = nh * R); } nx = s.x + (s.width - nw); ny = s.y + (s.height - nh); break;
        }

        const MIN = 2;
        if (nw < MIN) { if (["l","bl","tl"].includes(h)) nx = s.x + s.width - MIN; nw = MIN; if (lock) nh = MIN / R; }
        if (nh < MIN) { if (["t","tr","tl"].includes(h)) ny = s.y + s.height - MIN; nh = MIN; if (lock) nw = MIN * R; }
        if (nx < 0) { nw += nx; nx = 0; if (lock) nh = nw / R; }
        if (ny < 0) { nh += ny; ny = 0; if (lock) nw = nh * R; }
        if (nx + nw > 100) { nw = 100 - nx; if (lock) nh = nw / R; }
        if (ny + nh > 100) { nh = 100 - ny; if (lock) nw = nh * R; }

        const r = (v: number) => Math.round(v * 10) / 10;
        const patch = { x: r(nx), y: r(ny), width: r(nw), height: r(nh) };

        if (src === "element") {
          setElements((prev) => prev.map((el) => el.id === activeResizeId.current ? { ...el, ...patch } : el));
        } else if (src === "component") {
          setComponents((prev) => prev.map((c) => c.id === activeResizeId.current ? { ...c, ...patch } : c));
        } else if (src === "decoration") {
          setFocusedDraftComp((prev) => !prev ? prev : { ...prev, decorations: prev.decorations.map((d) => d.id === activeResizeId.current ? { ...d, ...patch } : d) });
        }
      }
    };

    const onUp = () => {
      const wasDragging = activeDragId.current !== null;
      const wasResizing = activeResizeId.current !== null;
      activeDragId.current = null;
      activeDragSource.current = null;
      activeResizeId.current = null;
      activeResizeSource.current = null;
      activeHandle.current = null;
      forceRender((n) => n + 1);
      if (wasDragging || wasResizing) {
        if (histTimerRef.current) clearTimeout(histTimerRef.current);
        suppressHistRef.current = true;
        pushHistory(elementsRef.current, componentsRef.current);
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [pct, pctFocused, pushHistory]);

  // Debounced history push for property-panel changes (add/delete captured immediately above).
  useEffect(() => {
    if (suppressHistRef.current) { suppressHistRef.current = false; return; }
    if (histTimerRef.current) clearTimeout(histTimerRef.current);
    histTimerRef.current = setTimeout(() => { pushHistory(elements, components); }, 400);
    return () => { if (histTimerRef.current) clearTimeout(histTimerRef.current); };
  }, [elements, components, pushHistory]);

  // Ctrl+Z / Ctrl+Y keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && e.key === "z") { e.preventDefault(); undo(); }
      else if (e.ctrlKey && (e.key === "y" || (e.shiftKey && e.key === "Z"))) { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const startDrag = useCallback(
    (e: React.MouseEvent, item: { id: string; x: number; y: number; width: number; height: number }, source: "element" | "component" | "decoration") => {
      e.preventDefault();
      e.stopPropagation();
      const ref = source === "decoration" ? focusedCanvasRef : canvasRef;
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = ((e.clientX - rect.left) / rect.width) * 100;
      const cy = ((e.clientY - rect.top) / rect.height) * 100;
      dragStart.current = { offsetX: cx - item.x, offsetY: cy - item.y, width: item.width, height: item.height };
      activeDragId.current = item.id;
      activeDragSource.current = source;
      if (source === "decoration") setFocusedSelectedDecId(item.id);
      else setSelectedId(item.id);
    },
    [],
  );

  const startResize = useCallback(
    (e: React.MouseEvent, item: { id: string; x: number; y: number; width: number; height: number }, handle: string, source: "element" | "component" | "decoration") => {
      e.preventDefault();
      e.stopPropagation();
      const ref = source === "decoration" ? focusedCanvasRef : canvasRef;
      const rect = ref.current?.getBoundingClientRect();
      if (!rect) return;
      const cx = ((e.clientX - rect.left) / rect.width) * 100;
      const cy = ((e.clientY - rect.top) / rect.height) * 100;
      resizeStart.current = { x: item.x, y: item.y, width: item.width, height: item.height, clickX: cx, clickY: cy, aspectRatio: item.width / (item.height || 1) };
      activeResizeId.current = item.id;
      activeResizeSource.current = source;
      activeHandle.current = handle;
      if (source === "decoration") setFocusedSelectedDecId(item.id);
      else setSelectedId(item.id);
    },
    [],
  );

  // ─── Element actions ──────────────────────────────────────────────────────
  const addImage = useCallback(async () => {
    const paths = await window.electron.openFileDialog({
      properties: ["openFile"],
      filters: [{ name: "Image", extensions: ["png","jpg","jpeg","gif","webp","svg"] }],
    });
    if (!paths?.length) return;
    const fullPath = paths[0];
    const bname = fileBasename(fullPath);
    const el = newElement("image", { asset: bname, width: 30, height: 20 });
    setElements((prev) => [...prev, el]);
    setAssetPaths((prev) => ({ ...prev, [bname]: `file:///${fullPath.replace(/\\/g, "/")}` }));
    setSelectedId(el.id);
  }, []);

  const addText = useCallback(() => {
    const el = newElement("text", { textContent: "Text", fontSize: 24, textColor: "#ffffff", fontFamily: "sans-serif", fontWeight: "normal", fontStyle: "normal", width: 30, height: 10 });
    setElements((prev) => [...prev, el]);
    setSelectedId(el.id);
  }, []);

  const addColor = useCallback(() => {
    const el = newElement("color", { backgroundColor: "#7c3aed", width: 30, height: 15 });
    setElements((prev) => [...prev, el]);
    setSelectedId(el.id);
  }, []);

  const addComponent = useCallback((type: CompType) => {
    const c = newComponent(type);
    setComponents((prev) => [...prev, c]);
    setSelectedId(c.id);
  }, []);

  const deleteSelected = useCallback(() => {
    if (!selectedId) return;
    setElements((prev) => prev.filter((e) => e.id !== selectedId));
    setComponents((prev) => prev.filter((c) => c.id !== selectedId));
    setSelectedId(null);
  }, [selectedId]);

  const updateEl = useCallback((patch: Partial<OverlayThemeElement>) => {
    setElements((prev) => prev.map((e) => (e.id === selectedId ? { ...e, ...patch } : e)));
  }, [selectedId]);

  const updateComp = useCallback((patch: Partial<OverlayThemeComponent>) => {
    setComponents((prev) => prev.map((c) => (c.id === selectedId ? { ...c, ...patch } : c)));
  }, [selectedId]);

  const updateCompStyle = useCallback((patch: Partial<ComponentStyleProps>) => {
    setComponents((prev) => prev.map((c) => c.id === selectedId ? { ...c, styleProps: { ...c.styleProps, ...patch } } : c));
  }, [selectedId]);

  // ─── Focused editor ───────────────────────────────────────────────────────
  const openFocusedEditor = useCallback((compId: string) => {
    const comp = components.find((c) => c.id === compId);
    if (!comp) return;
    setFocusedDraftComp({ ...comp, decorations: comp.decorations.map((d) => ({ ...d })) });
    setFocusedComponentId(compId);
    setFocusedSelectedDecId(null);
    setSelectedId(null);
  }, [components]);

  const handleFocusedApply = useCallback(() => {
    if (!focusedDraftComp) return;
    setComponents((prev) => prev.map((c) => c.id === focusedDraftComp.id ? focusedDraftComp : c));
    setFocusedComponentId(null);
    setFocusedDraftComp(null);
    setFocusedSelectedDecId(null);
  }, [focusedDraftComp]);

  const handleFocusedCancel = useCallback(() => {
    setFocusedComponentId(null);
    setFocusedDraftComp(null);
    setFocusedSelectedDecId(null);
  }, []);

  const updateFocusedDec = useCallback((patch: Partial<OverlayThemeElement>) => {
    setFocusedDraftComp((prev) => !prev ? prev : {
      ...prev,
      decorations: prev.decorations.map((d) => d.id === focusedSelectedDecId ? { ...d, ...patch } : d),
    });
  }, [focusedSelectedDecId]);

  const updateFocusedCompStyle = useCallback((patch: Partial<ComponentStyleProps>) => {
    setFocusedDraftComp((prev) => !prev ? prev : { ...prev, styleProps: { ...prev.styleProps, ...patch } });
  }, []);

  const addFocusedImage = useCallback(async () => {
    const paths = await window.electron.openFileDialog({ properties: ["openFile"], filters: [{ name: "Image", extensions: ["png","jpg","jpeg","gif","webp","svg"] }] });
    if (!paths?.length) return;
    const bname = fileBasename(paths[0]);
    const dec = newElement("image", { asset: bname, width: 30, height: 20 });
    setFocusedDraftComp((prev) => !prev ? prev : { ...prev, decorations: [...prev.decorations, dec] });
    setAssetPaths((prev) => ({ ...prev, [bname]: `file:///${paths[0].replace(/\\/g, "/")}` }));
    setFocusedSelectedDecId(dec.id);
  }, []);

  const addFocusedText = useCallback(() => {
    const dec = newElement("text", { textContent: "Text", fontSize: 5, textColor: "#ffffff", fontFamily: "sans-serif", fontWeight: "normal", fontStyle: "normal", width: 30, height: 10 });
    setFocusedDraftComp((prev) => !prev ? prev : { ...prev, decorations: [...prev.decorations, dec] });
    setFocusedSelectedDecId(dec.id);
  }, []);

  const addFocusedColor = useCallback(() => {
    const dec = newElement("color", { backgroundColor: "#7c3aed", width: 30, height: 15 });
    setFocusedDraftComp((prev) => !prev ? prev : { ...prev, decorations: [...prev.decorations, dec] });
    setFocusedSelectedDecId(dec.id);
  }, []);

  // ─── Variables ────────────────────────────────────────────────────────────
  const addVariable = () =>
    setVariables((prev) => [...prev, { key: `var_${Date.now()}`, label: "New Variable", default: "" }]);
  const updateVar = (idx: number, patch: Partial<OverlayThemeVariable>) =>
    setVariables((prev) => prev.map((v, i) => (i === idx ? { ...v, ...patch } : v)));
  const deleteVar = (idx: number) =>
    setVariables((prev) => prev.filter((_, i) => i !== idx));

  // ─── Save / Open ──────────────────────────────────────────────────────────
  const buildThemeJson = () => JSON.stringify({
    id: meta.id, name: meta.name, author: meta.author, version: meta.version,
    description: meta.description, variables, elements, components,
  }, null, 2);

  const handleOpen = useCallback(async () => {
    const paths = await window.electron.openFileDialog({
      properties: ["openFile"],
      filters: [{ name: "SonicPlank Theme", extensions: ["sptheme"] }],
    });
    if (!paths?.length) return;
    const result = await window.electron.openThemeForEditing(paths[0]);
    if ("error" in result) { alert(`Failed to open theme: ${(result as any).error}`); return; }
    const { themeJson, tmpDir } = result as { themeJson: string; tmpDir: string };
    const parsed = JSON.parse(themeJson);
    setMeta({ id: parsed.id ?? crypto.randomUUID(), name: parsed.name ?? "Untitled", author: parsed.author ?? "", version: parsed.version ?? "1.0.0", description: parsed.description ?? "" });
    setVariables(parsed.variables ?? []);
    setElements(parsed.elements ?? []);
    setComponents(parsed.components ?? []);
    const newAssetPaths: Record<string, string> = {};
    for (const el of (parsed.elements ?? []) as OverlayThemeElement[]) {
      if (el.asset) newAssetPaths[el.asset] = `file:///${`${tmpDir}/assets/${el.asset}`.replace(/\\/g, "/")}`;
    }
    setAssetPaths(newAssetPaths);
    setOpenFilePath(paths[0]);
    setSelectedId(null);
    // Reset history so the loaded state is the undo floor.
    historyRef.current = [{ elements: parsed.elements ?? [], components: parsed.components ?? [] }];
    historyIdxRef.current = 0;
    suppressHistRef.current = true;
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  const handleSave = useCallback(async (forcePicker = false) => {
    let savePath = openFilePath;
    if (!savePath || forcePicker) {
      const result = await window.electron.showSaveDialog({
        title: "Save Overlay Theme",
        defaultPath: `${meta.name.replace(/[^a-z0-9]/gi, "_")}.sptheme`,
        filters: [{ name: "SonicPlank Theme", extensions: ["sptheme"] }],
      });
      if (result.canceled || !result.filePath) return;
      savePath = result.filePath as string;
    }
    const assets: { localPath: string; archiveName: string }[] = [];
    for (const el of elements) {
      if (el.asset && assetPaths[el.asset]) {
        assets.push({ localPath: assetPaths[el.asset].replace(/^file:\/\/\//, "").replace(/\//g, "\\"), archiveName: el.asset });
      }
    }
    const res = await window.electron.saveOverlayTheme({ themeJson: buildThemeJson(), assets, savePath: savePath! });
    if (res.success) setOpenFilePath(savePath);
    else alert(`Save failed: ${res.error ?? "unknown error"}`);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, elements, components, variables, assetPaths, openFilePath]);

  // ─── Canvas helpers ───────────────────────────────────────────────────────
  const elementTypeIcon = (type: OverlayThemeElement["type"]) => {
    if (type === "image") return <ImagePlus className="w-3 h-3 shrink-0 text-sky-400" />;
    if (type === "text")  return <Type      className="w-3 h-3 shrink-0 text-amber-400" />;
    return                       <Square    className="w-3 h-3 shrink-0 text-purple-400" />;
  };

  const elementLayerLabel = (el: OverlayThemeElement) => {
    if (el.type === "image") return el.asset ?? "image";
    if (el.type === "text")  return el.textContent ? el.textContent.slice(0, 20) : "text";
    return el.backgroundColor ?? "color";
  };

  const renderCanvasElement = (el: OverlayThemeElement) => {
    const isSelected = el.id === selectedId;
    const imgSrc = el.type === "image" && el.asset ? assetPaths[el.asset] ?? "" : "";
    return (
      <div
        key={el.id}
        onMouseDown={(e) => startDrag(e, el, "element")}
        className={`absolute select-none cursor-move overflow-hidden ${isSelected ? "ring-2 ring-violet-400" : "hover:ring-1 hover:ring-violet-400/50"}`}
        style={{ left: `${el.x}%`, top: `${el.y}%`, width: `${el.width}%`, height: `${el.height}%`, opacity: el.opacity, zIndex: isSelected ? 10 : 1 }}
      >
        {el.type === "image" && imgSrc && (
          <img src={imgSrc} alt="" className="w-full h-full object-contain pointer-events-none" draggable={false} />
        )}
        {el.type === "image" && !imgSrc && (
          <div className="w-full h-full bg-zinc-700/60 border border-dashed border-zinc-500 flex items-center justify-center">
            <ImagePlus className="w-4 h-4 text-zinc-400" />
          </div>
        )}
        {el.type === "text" && (
          <div className="w-full h-full flex items-center overflow-hidden pointer-events-none"
            style={{ color: el.textColor ?? "#ffffff", fontSize: `${el.fontSize ?? 24}px`, fontFamily: el.fontFamily ?? "sans-serif", fontWeight: el.fontWeight ?? "normal", fontStyle: el.fontStyle ?? "normal", lineHeight: 1.2 }}>
            {el.textContent || <span className="italic text-zinc-500">empty text</span>}
          </div>
        )}
        {el.type === "color" && (
          <div className="w-full h-full pointer-events-none" style={{ backgroundColor: el.backgroundColor ?? "#7c3aed" }} />
        )}
        {isSelected && <ResizeHandles onMouseDown={(e, h) => startResize(e, el, h, "element")} />}
      </div>
    );
  };

  const renderCanvasComponent = (comp: OverlayThemeComponent) => {
    const isSelected = comp.id === selectedId;
    const m = COMP_META[comp.componentType];
    return (
      <div
        key={comp.id}
        onMouseDown={(e) => startDrag(e, comp, "component")}
        onDoubleClick={(e) => { e.stopPropagation(); openFocusedEditor(comp.id); }}
        className={`absolute select-none cursor-move overflow-hidden ${isSelected ? "ring-2 ring-violet-400" : "hover:ring-1 hover:ring-violet-400/50"}`}
        style={{ left: `${comp.x}%`, top: `${comp.y}%`, width: `${comp.width}%`, height: `${comp.height}%`, opacity: comp.opacity, zIndex: isSelected ? 10 : 1 }}
      >
        <ComponentPreviewCanvas component={comp} />
        {/* Type chip overlay */}
        <div className={`absolute top-0.5 left-0.5 flex items-center gap-0.5 px-1 py-0.5 rounded text-[7px] font-bold uppercase tracking-wide bg-black/70 ${m.textColor} pointer-events-none`}>
          {compTypeIcon(comp.componentType, "w-2 h-2 shrink-0")}
          {m.label}
        </div>
        {isSelected && <ResizeHandles onMouseDown={(e, h) => startResize(e, comp, h, "component")} />}
      </div>
    );
  };

  const isEmpty = elements.length === 0 && components.length === 0;

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <AnimatedRoute variant="fade">
      <div className="flex flex-col h-[calc(100vh-65px)] overflow-hidden bg-background text-foreground">

        {/* ── Top bar ── */}
        <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0 flex-wrap">
          <span className="text-sm font-bold text-violet-400 tracking-wide mr-1">Marquee</span>
          <input value={meta.name} onChange={(e) => setMeta((m) => ({ ...m, name: e.target.value }))} placeholder="Theme name"
            className="bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:border-violet-500 focus:outline-none w-40" />
          <input value={meta.author} onChange={(e) => setMeta((m) => ({ ...m, author: e.target.value }))} placeholder="Author"
            className="bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:border-violet-500 focus:outline-none w-28" />
          <input value={meta.description} onChange={(e) => setMeta((m) => ({ ...m, description: e.target.value }))} placeholder="Description"
            className="bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:border-violet-500 focus:outline-none flex-1 min-w-0" />
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)"
              className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium bg-muted hover:bg-secondary border border-border rounded cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)"
              className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium bg-muted hover:bg-secondary border border-border rounded cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <Redo2 className="w-3.5 h-3.5" />
            </button>
            <button onClick={handleOpen}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-muted hover:bg-secondary border border-border rounded cursor-pointer transition-colors">
              <FolderOpen className="w-3.5 h-3.5" /> Open
            </button>
            <button onClick={() => handleSave(false)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white rounded cursor-pointer transition-colors">
              <Save className="w-3.5 h-3.5" /> Save
            </button>
            <button onClick={() => handleSave(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-muted hover:bg-secondary border border-border rounded cursor-pointer transition-colors">
              Save As…
            </button>
          </div>
        </div>

        {/* ── Body ── */}
        <div className="flex flex-1 min-h-0 overflow-hidden">

          {/* ── Left panel ── */}
          <div className="w-52 shrink-0 border-r border-border flex flex-col overflow-hidden">

            {/* Decorations add buttons */}
            <div className="shrink-0 border-b border-border p-2">
              <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Decorations</div>
              <div className="flex gap-1">
                <button onClick={addImage} title="Add image"
                  className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] font-semibold bg-sky-600/20 hover:bg-sky-600/40 border border-sky-500/30 text-sky-300 rounded cursor-pointer transition-colors">
                  <ImagePlus className="w-3 h-3" /> Image
                </button>
                <button onClick={addText} title="Add text"
                  className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] font-semibold bg-amber-600/20 hover:bg-amber-600/40 border border-amber-500/30 text-amber-300 rounded cursor-pointer transition-colors">
                  <Type className="w-3 h-3" /> Text
                </button>
                <button onClick={addColor} title="Add color block"
                  className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] font-semibold bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/30 text-purple-300 rounded cursor-pointer transition-colors">
                  <Square className="w-3 h-3" /> Color
                </button>
              </div>
            </div>

            {/* Components picker */}
            <div className="shrink-0 border-b border-border p-2">
              <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Overlay Components</div>
              <div className="grid grid-cols-2 gap-1">
                {(Object.entries(COMP_META) as [CompType, CompTypeMeta][]).map(([type, m]) => (
                  <button key={type} onClick={() => addComponent(type)}
                    className={`flex items-center gap-1 px-2 py-1 text-[10px] font-semibold border rounded cursor-pointer transition-colors ${m.bgColor} hover:opacity-80 ${m.borderColor} ${m.textColor}`}>
                    {compTypeIcon(type, "w-3 h-3 shrink-0")}
                    <span className="truncate">{m.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Layer lists */}
            <div className="flex-1 overflow-y-auto min-h-0">

              {/* Decorations layer list */}
              <div className="px-2 pt-2 pb-0.5 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                Decoration Layers
              </div>
              {elements.length === 0 && (
                <div className="px-2 pb-1 text-[10px] text-muted-foreground italic">None</div>
              )}
              {elements.length > 0 && (
                <SortableList items={elements} onChange={setElements} renderItem={(el) => (
                  <SortableItem id={el.id}>
                    <div onClick={() => setSelectedId(el.id)}
                      className={`flex items-center gap-1.5 px-2 py-1.5 w-full cursor-pointer transition-colors rounded mx-1 my-0.5 ${el.id === selectedId ? "bg-violet-600/20 text-violet-200" : "hover:bg-secondary text-foreground/80"}`}>
                      <SortableDragHandle />
                      {elementTypeIcon(el.type)}
                      <span className="truncate flex-1 text-[10px]">{elementLayerLabel(el)}</span>
                    </div>
                  </SortableItem>
                )} />
              )}

              {/* Components layer list */}
              <div className="px-2 pt-2 pb-0.5 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                Component Layers
              </div>
              {components.length === 0 && (
                <div className="px-2 pb-1 text-[10px] text-muted-foreground italic">None</div>
              )}
              {components.length > 0 && (
                <SortableList items={components} onChange={setComponents} renderItem={(comp) => (
                  <SortableItem id={comp.id}>
                    <div onClick={() => setSelectedId(comp.id)} onDoubleClick={() => openFocusedEditor(comp.id)}
                      className={`flex items-center gap-1.5 px-2 py-1.5 w-full cursor-pointer transition-colors rounded mx-1 my-0.5 ${comp.id === selectedId ? "bg-violet-600/20 text-violet-200" : "hover:bg-secondary text-foreground/80"}`}>
                      <SortableDragHandle />
                      {compTypeIcon(comp.componentType, "w-3 h-3 shrink-0")}
                      <span className={`truncate flex-1 text-[10px] ${COMP_META[comp.componentType].textColor}`}>{COMP_META[comp.componentType].label}</span>
                    </div>
                  </SortableItem>
                )} />
              )}

              {/* Variables */}
              <div className="px-2 pt-3 pb-1 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                Variables
                <button onClick={addVariable} className="flex items-center gap-0.5 text-[9px] text-violet-400 hover:text-violet-300 cursor-pointer">
                  <Plus className="w-2.5 h-2.5" /> Add
                </button>
              </div>
              {variables.length === 0 && (
                <div className="px-2 text-[10px] text-muted-foreground italic">No variables</div>
              )}
              {variables.map((v, idx) => (
                <div key={idx} className="px-2 py-1 flex flex-col gap-0.5 border-b border-border/30">
                  <div className="flex items-center gap-1">
                    <input value={v.key} onChange={(e) => updateVar(idx, { key: e.target.value })} placeholder="key"
                      className="flex-1 min-w-0 bg-muted border border-border rounded px-1.5 py-0.5 text-[9px] text-foreground focus:border-violet-500 focus:outline-none font-mono" />
                    <button onClick={() => deleteVar(idx)} className="text-red-400 hover:text-red-300 cursor-pointer"><Trash2 className="w-3 h-3" /></button>
                  </div>
                  <input value={v.label} onChange={(e) => updateVar(idx, { label: e.target.value })} placeholder="label"
                    className="w-full bg-muted border border-border rounded px-1.5 py-0.5 text-[9px] text-foreground focus:border-violet-500 focus:outline-none" />
                  <input value={v.default} onChange={(e) => updateVar(idx, { default: e.target.value })} placeholder="default"
                    className="w-full bg-muted border border-border rounded px-1.5 py-0.5 text-[9px] text-foreground focus:border-violet-500 focus:outline-none" />
                </div>
              ))}
            </div>
          </div>

          {/* ── Canvas ── */}
          <div className="flex-1 flex items-center justify-center bg-zinc-950 min-w-0 overflow-hidden p-4">
            <div className="relative bg-black shadow-2xl"
              style={{ aspectRatio: "16/9", maxHeight: "100%", maxWidth: "100%", width: "min(100%, calc((100vh - 120px) * 16/9))" }}>
              <div ref={canvasRef} className="absolute inset-0"
                onClick={(e) => { if (e.target === e.currentTarget) setSelectedId(null); }}>
                {elements.map(renderCanvasElement)}
                {components.map(renderCanvasComponent)}
              </div>
              {isEmpty && (
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-2">
                  <span className="text-zinc-600 text-sm">Add decorations or overlay components</span>
                  <span className="text-zinc-700 text-xs">from the left panel</span>
                </div>
              )}
            </div>
          </div>

          {/* ── Right panel ── */}
          <div className="w-56 shrink-0 border-l border-border flex flex-col overflow-y-auto">
            {!selectedId && (
              <div className="flex-1 flex items-center justify-center text-[10px] text-muted-foreground italic p-4 text-center">
                Select an element or component to edit its properties
              </div>
            )}

            {/* Element properties */}
            {selectedEl && (
              <div className="flex flex-col gap-3 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {elementTypeIcon(selectedEl.type)}
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{selectedEl.type}</span>
                  </div>
                  <button onClick={deleteSelected} className="text-red-400 hover:text-red-300 cursor-pointer" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>

                {/* Position & Size */}
                <div className="grid grid-cols-2 gap-1.5">
                  {(["x","y","width","height"] as const).map((field) => (
                    <div key={field} className="flex flex-col gap-0.5">
                      <label className="text-[9px] text-muted-foreground uppercase">{field === "width" ? "W" : field === "height" ? "H" : field.toUpperCase()}</label>
                      <input type="number" value={selectedEl[field]} step={0.1}
                        onChange={(e) => updateEl({ [field]: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-muted border border-border rounded px-1.5 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none" />
                    </div>
                  ))}
                </div>

                {/* Opacity */}
                <div className="flex flex-col gap-0.5">
                  <label className="text-[9px] text-muted-foreground uppercase">Opacity</label>
                  <input type="range" min={0} max={1} step={0.01} value={selectedEl.opacity}
                    onChange={(e) => updateEl({ opacity: parseFloat(e.target.value) })} className="w-full accent-violet-500" />
                  <span className="text-[9px] text-muted-foreground text-right">{Math.round(selectedEl.opacity * 100)}%</span>
                </div>

                {/* Text-specific */}
                {selectedEl.type === "text" && <>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[9px] text-muted-foreground uppercase">Content</label>
                    <textarea value={selectedEl.textContent ?? ""} onChange={(e) => updateEl({ textContent: e.target.value })} rows={2}
                      placeholder="Use {{key}} for variables"
                      className="w-full bg-muted border border-border rounded px-2 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none resize-none" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[9px] text-muted-foreground uppercase">Font Size (px)</label>
                    <input type="number" value={selectedEl.fontSize ?? 24} step={1} onChange={(e) => updateEl({ fontSize: parseInt(e.target.value) || 24 })}
                      className="w-full bg-muted border border-border rounded px-1.5 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none" />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[9px] text-muted-foreground uppercase">Font Family</label>
                    <input type="text" value={selectedEl.fontFamily ?? "sans-serif"} onChange={(e) => updateEl({ fontFamily: e.target.value })}
                      className="w-full bg-muted border border-border rounded px-1.5 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[9px] text-muted-foreground uppercase">Weight</label>
                      <select value={selectedEl.fontWeight ?? "normal"} onChange={(e) => updateEl({ fontWeight: e.target.value })}
                        className="w-full bg-muted border border-border rounded px-1 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none">
                        <option value="normal">Normal</option>
                        <option value="bold">Bold</option>
                        <option value="100">100</option><option value="300">300</option>
                        <option value="500">500</option><option value="700">700</option><option value="900">900</option>
                      </select>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <label className="text-[9px] text-muted-foreground uppercase">Style</label>
                      <select value={selectedEl.fontStyle ?? "normal"} onChange={(e) => updateEl({ fontStyle: e.target.value })}
                        className="w-full bg-muted border border-border rounded px-1 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none">
                        <option value="normal">Normal</option>
                        <option value="italic">Italic</option>
                      </select>
                    </div>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[9px] text-muted-foreground uppercase">Text Color</label>
                    <CustomColorPicker value={selectedEl.textColor ?? "#ffffff"} onChange={(v) => updateEl({ textColor: v })} />
                  </div>
                </>}

                {/* Color-specific */}
                {selectedEl.type === "color" && (
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[9px] text-muted-foreground uppercase">Fill Color</label>
                    <CustomColorPicker value={selectedEl.backgroundColor ?? "#7c3aed"} onChange={(v) => updateEl({ backgroundColor: v })} />
                  </div>
                )}

                {/* Image-specific */}
                {selectedEl.type === "image" && (
                  <div className="flex flex-col gap-1">
                    <label className="text-[9px] text-muted-foreground uppercase">Asset</label>
                    <div className="text-[10px] text-foreground/60 font-mono truncate">{selectedEl.asset ?? "none"}</div>
                    <button onClick={async () => {
                      const paths = await window.electron.openFileDialog({ properties: ["openFile"], filters: [{ name: "Image", extensions: ["png","jpg","jpeg","gif","webp","svg"] }] });
                      if (!paths?.length) return;
                      const bname = fileBasename(paths[0]);
                      updateEl({ asset: bname });
                      setAssetPaths((prev) => ({ ...prev, [bname]: `file:///${paths[0].replace(/\\/g, "/")}` }));
                    }} className="text-[10px] text-sky-400 hover:text-sky-300 cursor-pointer text-left">
                      Replace image…
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Component properties */}
            {selectedComp && !selectedEl && (
              <div className="flex flex-col gap-3 p-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    {compTypeIcon(selectedComp.componentType)}
                    <span className={`text-[10px] font-semibold uppercase tracking-wider ${COMP_META[selectedComp.componentType].textColor}`}>
                      {COMP_META[selectedComp.componentType].label}
                    </span>
                  </div>
                  <button onClick={deleteSelected} className="text-red-400 hover:text-red-300 cursor-pointer" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>

                {/* Position & Size */}
                <div className="grid grid-cols-2 gap-1.5">
                  {(["x","y","width","height"] as const).map((field) => (
                    <div key={field} className="flex flex-col gap-0.5">
                      <label className="text-[9px] text-muted-foreground uppercase">{field === "width" ? "W" : field === "height" ? "H" : field.toUpperCase()}</label>
                      <input type="number" value={selectedComp[field]} step={0.1}
                        onChange={(e) => updateComp({ [field]: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-muted border border-border rounded px-1.5 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none" />
                    </div>
                  ))}
                </div>

                {/* Opacity */}
                <div className="flex flex-col gap-0.5">
                  <label className="text-[9px] text-muted-foreground uppercase">Opacity</label>
                  <input type="range" min={0} max={1} step={0.01} value={selectedComp.opacity}
                    onChange={(e) => updateComp({ opacity: parseFloat(e.target.value) })} className="w-full accent-violet-500" />
                  <span className="text-[9px] text-muted-foreground text-right">{Math.round(selectedComp.opacity * 100)}%</span>
                </div>

                {/* Edit style hint */}
                <button onClick={() => openFocusedEditor(selectedComp.id)}
                  className={`w-full py-1.5 text-xs font-semibold rounded cursor-pointer border transition-colors ${COMP_META[selectedComp.componentType].borderColor} ${COMP_META[selectedComp.componentType].textColor} ${COMP_META[selectedComp.componentType].bgColor} hover:opacity-80`}>
                  Edit Style & Decorations…
                </button>

                {selectedComp.decorations.length > 0 && (
                  <div className="text-[9px] text-muted-foreground">{selectedComp.decorations.length} decoration{selectedComp.decorations.length !== 1 ? "s" : ""} applied</div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ── Focused component editor (Phase 5) ── */}
        {focusedComponentId && focusedDraftComp && (() => {
          const comp = focusedDraftComp;
          const m = COMP_META[comp.componentType];
          const focusedDec = comp.decorations.find((d) => d.id === focusedSelectedDecId) ?? null;
          const sp = comp.styleProps;

          const renderFocusedDecoration = (dec: OverlayThemeElement) => {
            const isSel = dec.id === focusedSelectedDecId;
            const imgSrc = dec.type === "image" && dec.asset ? assetPaths[dec.asset] ?? "" : "";
            return (
              <div key={dec.id}
                onMouseDown={(e) => startDrag(e, dec, "decoration")}
                className={`absolute select-none cursor-move overflow-hidden ${isSel ? "ring-2 ring-violet-400" : "hover:ring-1 hover:ring-violet-400/50"}`}
                style={{ left: `${dec.x}%`, top: `${dec.y}%`, width: `${dec.width}%`, height: `${dec.height}%`, opacity: dec.opacity, zIndex: isSel ? 10 : 1 }}
              >
                {dec.type === "image" && imgSrc && <img src={imgSrc} alt="" className="w-full h-full object-contain pointer-events-none" draggable={false} />}
                {dec.type === "image" && !imgSrc && <div className="w-full h-full bg-zinc-700/60 border border-dashed border-zinc-500 flex items-center justify-center"><ImagePlus className="w-4 h-4 text-zinc-400" /></div>}
                {dec.type === "text" && <div className="w-full h-full flex items-center overflow-hidden pointer-events-none" style={{ color: dec.textColor ?? "#fff", fontSize: `${dec.fontSize ?? 5}px`, fontFamily: dec.fontFamily ?? "sans-serif", fontWeight: dec.fontWeight ?? "normal", fontStyle: dec.fontStyle ?? "normal" }}>{dec.textContent || <span className="italic text-zinc-500">empty</span>}</div>}
                {dec.type === "color" && <div className="w-full h-full pointer-events-none" style={{ backgroundColor: dec.backgroundColor ?? "#7c3aed" }} />}
                {isSel && <ResizeHandles onMouseDown={(e, h) => startResize(e, dec, h, "decoration")} />}
              </div>
            );
          };

          return (
            <div className="absolute inset-0 z-50 flex flex-col bg-background">

              {/* Focused top bar */}
              <div className="flex items-center gap-3 px-4 py-2 border-b border-border shrink-0 flex-wrap">
                <div className="flex items-center gap-2">
                  {compTypeIcon(comp.componentType, "w-4 h-4")}
                  <span className={`text-sm font-bold ${m.textColor}`}>{m.label} Editor</span>
                </div>
                <div className="flex items-center gap-2 ml-auto shrink-0">
                  <button onClick={handleFocusedCancel}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-muted hover:bg-secondary border border-border rounded cursor-pointer transition-colors">
                    Cancel
                  </button>
                  <button onClick={handleFocusedApply}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-violet-600 hover:bg-violet-500 text-white rounded cursor-pointer transition-colors">
                    Apply
                  </button>
                </div>
              </div>

              {/* Focused body */}
              <div className="flex flex-1 min-h-0 overflow-hidden">

                {/* Left panel */}
                <div className="w-52 shrink-0 border-r border-border flex flex-col overflow-hidden">
                  <div className="shrink-0 border-b border-border p-2">
                    <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Add Decorations</div>
                    <div className="flex gap-1">
                      <button onClick={addFocusedImage}
                        className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] font-semibold bg-sky-600/20 hover:bg-sky-600/40 border border-sky-500/30 text-sky-300 rounded cursor-pointer transition-colors">
                        <ImagePlus className="w-3 h-3" /> Image
                      </button>
                      <button onClick={addFocusedText}
                        className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] font-semibold bg-amber-600/20 hover:bg-amber-600/40 border border-amber-500/30 text-amber-300 rounded cursor-pointer transition-colors">
                        <Type className="w-3 h-3" /> Text
                      </button>
                      <button onClick={addFocusedColor}
                        className="flex-1 flex items-center justify-center gap-1 py-1 text-[10px] font-semibold bg-purple-600/20 hover:bg-purple-600/40 border border-purple-500/30 text-purple-300 rounded cursor-pointer transition-colors">
                        <Square className="w-3 h-3" /> Color
                      </button>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto min-h-0">
                    <div className="px-2 pt-2 pb-0.5 text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Decoration Layers</div>
                    {comp.decorations.length === 0 && <div className="px-2 text-[10px] text-muted-foreground italic">None yet</div>}
                    {comp.decorations.length > 0 && (
                      <SortableList items={comp.decorations}
                        onChange={(newDecs) => setFocusedDraftComp((prev) => prev ? { ...prev, decorations: newDecs } : prev)}
                        renderItem={(dec) => (
                          <SortableItem id={dec.id}>
                            <div onClick={() => setFocusedSelectedDecId(dec.id)}
                              className={`flex items-center gap-1.5 px-2 py-1.5 w-full cursor-pointer transition-colors rounded mx-1 my-0.5 ${dec.id === focusedSelectedDecId ? "bg-violet-600/20 text-violet-200" : "hover:bg-secondary text-foreground/80"}`}>
                              <SortableDragHandle />
                              {elementTypeIcon(dec.type)}
                              <span className="truncate flex-1 text-[10px]">{elementLayerLabel(dec)}</span>
                            </div>
                          </SortableItem>
                        )}
                      />
                    )}
                  </div>
                </div>

                {/* Focused canvas */}
                <div className="flex-1 flex items-center justify-center bg-zinc-950 min-w-0 overflow-hidden p-4">
                  <div className="relative bg-black shadow-2xl"
                    style={{ aspectRatio: "16/9", maxHeight: "100%", maxWidth: "100%", width: "min(100%, calc((100vh - 120px) * 16/9))" }}>
                    <div ref={focusedCanvasRef} className="absolute inset-0"
                      onClick={(e) => { if (e.target === e.currentTarget) setFocusedSelectedDecId(null); }}>
                      <ComponentPreviewCanvas component={comp} />
                      {comp.decorations.map(renderFocusedDecoration)}
                    </div>
                  </div>
                </div>

                {/* Right panel */}
                <div className="w-56 shrink-0 border-l border-border flex flex-col overflow-y-auto">
                  {focusedDec ? (
                    /* Decoration properties */
                    <div className="flex flex-col gap-3 p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          {elementTypeIcon(focusedDec.type)}
                          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{focusedDec.type}</span>
                        </div>
                        <button onClick={() => { setFocusedDraftComp((prev) => prev ? { ...prev, decorations: prev.decorations.filter((d) => d.id !== focusedSelectedDecId) } : prev); setFocusedSelectedDecId(null); }}
                          className="text-red-400 hover:text-red-300 cursor-pointer" title="Delete">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5">
                        {(["x","y","width","height"] as const).map((field) => (
                          <div key={field} className="flex flex-col gap-0.5">
                            <label className="text-[9px] text-muted-foreground uppercase">{field === "width" ? "W" : field === "height" ? "H" : field.toUpperCase()}</label>
                            <input type="number" value={focusedDec[field]} step={0.1}
                              onChange={(e) => updateFocusedDec({ [field]: parseFloat(e.target.value) || 0 })}
                              className="w-full bg-muted border border-border rounded px-1.5 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none" />
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-col gap-0.5">
                        <label className="text-[9px] text-muted-foreground uppercase">Opacity</label>
                        <input type="range" min={0} max={1} step={0.01} value={focusedDec.opacity}
                          onChange={(e) => updateFocusedDec({ opacity: parseFloat(e.target.value) })} className="w-full accent-violet-500" />
                        <span className="text-[9px] text-muted-foreground text-right">{Math.round(focusedDec.opacity * 100)}%</span>
                      </div>

                      {focusedDec.type === "text" && <>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Content</label>
                          <textarea value={focusedDec.textContent ?? ""} onChange={(e) => updateFocusedDec({ textContent: e.target.value })} rows={2}
                            className="w-full bg-muted border border-border rounded px-2 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none resize-none" />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Font Size (px)</label>
                          <input type="number" value={focusedDec.fontSize ?? 5} step={1}
                            onChange={(e) => updateFocusedDec({ fontSize: parseInt(e.target.value) || 5 })}
                            className="w-full bg-muted border border-border rounded px-1.5 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none" />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Font Family</label>
                          <input type="text" value={focusedDec.fontFamily ?? "sans-serif"}
                            onChange={(e) => updateFocusedDec({ fontFamily: e.target.value })}
                            className="w-full bg-muted border border-border rounded px-1.5 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none" />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Text Color</label>
                          <CustomColorPicker value={focusedDec.textColor ?? "#ffffff"} onChange={(v) => updateFocusedDec({ textColor: v })} />
                        </div>
                      </>}

                      {focusedDec.type === "color" && (
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Fill Color</label>
                          <CustomColorPicker value={focusedDec.backgroundColor ?? "#7c3aed"} onChange={(v) => updateFocusedDec({ backgroundColor: v })} />
                        </div>
                      )}

                      {focusedDec.type === "image" && (
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] text-muted-foreground uppercase">Asset</label>
                          <div className="text-[10px] text-foreground/60 font-mono truncate">{focusedDec.asset ?? "none"}</div>
                          <button onClick={async () => {
                            const paths = await window.electron.openFileDialog({ properties: ["openFile"], filters: [{ name: "Image", extensions: ["png","jpg","jpeg","gif","webp","svg"] }] });
                            if (!paths?.length) return;
                            const bname = fileBasename(paths[0]);
                            updateFocusedDec({ asset: bname });
                            setAssetPaths((prev) => ({ ...prev, [bname]: `file:///${paths[0].replace(/\\/g, "/")}` }));
                          }} className="text-[10px] text-sky-400 hover:text-sky-300 cursor-pointer text-left">
                            Replace image…
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    /* Component style props */
                    <div className="flex flex-col gap-3 p-3">
                      <div className="flex items-center gap-1.5 pb-1 border-b border-border/40">
                        {compTypeIcon(comp.componentType, "w-3.5 h-3.5")}
                        <span className={`text-[10px] font-semibold uppercase tracking-wider ${m.textColor}`}>Style Properties</span>
                      </div>

                      {/* All types: backgroundColor */}
                      {comp.componentType !== "text" && comp.componentType !== "image" && (
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Background</label>
                          <CustomColorPicker value={sp.backgroundColor ?? "rgba(0,0,0,0.5)"} onChange={(v) => updateFocusedCompStyle({ backgroundColor: v })} />
                        </div>
                      )}

                      {/* text */}
                      {comp.componentType === "text" && <>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Content</label>
                          <textarea value={sp.textContent ?? ""} onChange={(e) => updateFocusedCompStyle({ textContent: e.target.value })} rows={2}
                            className="w-full bg-muted border border-border rounded px-2 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none resize-none" />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Font Size (%)</label>
                          <input type="number" value={sp.fontSize ?? 5} step={0.5}
                            onChange={(e) => updateFocusedCompStyle({ fontSize: parseFloat(e.target.value) || 5 })}
                            className="w-full bg-muted border border-border rounded px-1.5 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none" />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Font Family</label>
                          <input type="text" value={sp.fontFamily ?? "sans-serif"}
                            onChange={(e) => updateFocusedCompStyle({ fontFamily: e.target.value })}
                            className="w-full bg-muted border border-border rounded px-1.5 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none" />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Text Color</label>
                          <CustomColorPicker value={sp.textColor ?? "#ffffff"} onChange={(v) => updateFocusedCompStyle({ textColor: v })} />
                        </div>
                      </>}

                      {/* image */}
                      {comp.componentType === "image" && (
                        <div className="flex flex-col gap-1">
                          <label className="text-[9px] text-muted-foreground uppercase">Asset</label>
                          <div className="text-[10px] text-foreground/60 font-mono truncate">{sp.asset ?? "none"}</div>
                          <button onClick={async () => {
                            const paths = await window.electron.openFileDialog({ properties: ["openFile"], filters: [{ name: "Image", extensions: ["png","jpg","jpeg","gif","webp","svg"] }] });
                            if (!paths?.length) return;
                            const bname = fileBasename(paths[0]);
                            updateFocusedCompStyle({ asset: bname });
                            setAssetPaths((prev) => ({ ...prev, [bname]: `file:///${paths[0].replace(/\\/g, "/")}` }));
                          }} className="text-[10px] text-sky-400 hover:text-sky-300 cursor-pointer text-left">
                            Choose image…
                          </button>
                        </div>
                      )}

                      {/* visualizer */}
                      {comp.componentType === "visualizer" && <>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Style</label>
                          <select value={sp.visualizerType ?? "bars"} onChange={(e) => updateFocusedCompStyle({ visualizerType: e.target.value })}
                            className="w-full bg-muted border border-border rounded px-1 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none">
                            {["bars","wave","circle","blocks","dots"].map((t) => <option key={t} value={t}>{t}</option>)}
                          </select>
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Bar Color</label>
                          <CustomColorPicker value={sp.barColor ?? "#6366f1"} onChange={(v) => updateFocusedCompStyle({ barColor: v })} />
                        </div>
                      </>}

                      {/* nowPlaying */}
                      {comp.componentType === "nowPlaying" && <>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Text Color</label>
                          <CustomColorPicker value={sp.textColor ?? "#ffffff"} onChange={(v) => updateFocusedCompStyle({ textColor: v })} />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Progress Color</label>
                          <CustomColorPicker value={sp.progressColor ?? "#6366f1"} onChange={(v) => updateFocusedCompStyle({ progressColor: v })} />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Font Family</label>
                          <input type="text" value={sp.fontFamily ?? "sans-serif"}
                            onChange={(e) => updateFocusedCompStyle({ fontFamily: e.target.value })}
                            className="w-full bg-muted border border-border rounded px-1.5 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none" />
                        </div>
                      </>}

                      {/* twitchChat */}
                      {comp.componentType === "twitchChat" && <>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Text Color</label>
                          <CustomColorPicker value={sp.textColor ?? "#ffffff"} onChange={(v) => updateFocusedCompStyle({ textColor: v })} />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Font Family</label>
                          <input type="text" value={sp.fontFamily ?? "sans-serif"}
                            onChange={(e) => updateFocusedCompStyle({ fontFamily: e.target.value })}
                            className="w-full bg-muted border border-border rounded px-1.5 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none" />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Font Size (%)</label>
                          <input type="number" value={sp.fontSize ?? 2.5} step={0.5}
                            onChange={(e) => updateFocusedCompStyle({ fontSize: parseFloat(e.target.value) || 2.5 })}
                            className="w-full bg-muted border border-border rounded px-1.5 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none" />
                        </div>
                        <div className="flex flex-col gap-0.5">
                          <label className="text-[9px] text-muted-foreground uppercase">Max Messages</label>
                          <input type="number" value={sp.maxMessages ?? 10} step={1} min={1}
                            onChange={(e) => updateFocusedCompStyle({ maxMessages: parseInt(e.target.value) || 10 })}
                            className="w-full bg-muted border border-border rounded px-1.5 py-1 text-[10px] text-foreground focus:border-violet-500 focus:outline-none" />
                        </div>
                      </>}

                      {!focusedDec && <div className="text-[9px] text-muted-foreground italic pt-1">Select a decoration to edit its properties</div>}
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </AnimatedRoute>
  );
}
