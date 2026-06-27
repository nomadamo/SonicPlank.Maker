import { BaseNodeCard } from "./base-node";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { Palette as PaletteIcon, Upload as UploadIcon } from "lucide-react";
import { FlowNodeType, OverlayThemeMeta, OverlayThemeLayout, OverlayElement } from "@/types/flow-node";
import { useSetAtom } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import { useCallback, useEffect, useRef, useState } from "react";

function substituteVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? `{{${key}}}`);
}

function resolveThemeElement(
  el: OverlayThemeLayout["elements"][number],
  idPrefix: string,
  layout: OverlayThemeLayout,
  vars: Record<string, string>,
  overrides?: Partial<OverlayElement>,
): OverlayElement {
  const resolved: OverlayElement = {
    id: `${idPrefix}::${el.id}`,
    type: el.type as OverlayElement["type"],
    x: el.x, y: el.y,
    width: el.width, height: el.height,
    opacity: el.opacity,
    ...overrides,
  };
  if (el.type === "image" && el.asset) {
    const assetPath = layout.themeDir.replace(/\\/g, "/") + "/" + el.asset.replace(/\\/g, "/");
    resolved.imagePath = `file:///${assetPath}`;
  }
  if (el.type === "text") {
    resolved.textContent = el.textContent ? substituteVars(el.textContent, vars) : "";
    resolved.fontSize    = el.fontSize;
    resolved.textColor   = el.textColor;
    resolved.fontFamily  = el.fontFamily;
    resolved.fontWeight  = el.fontWeight;
    resolved.fontStyle   = el.fontStyle;
  }
  if (el.type === "color") {
    resolved.backgroundColor = el.backgroundColor;
  }
  return resolved;
}

function resolveElements(layout: OverlayThemeLayout, vars: Record<string, string>): OverlayElement[] {
  const idPfx = `theme::${layout.id}`;

  // Flat decoration elements (image / text / color)
  const resolved: OverlayElement[] = layout.elements.map((el) =>
    resolveThemeElement(el, idPfx, layout, vars),
  );

  // Component slots → placeholder OverlayElements + their decorations
  for (const comp of layout.components ?? []) {
    const sp = comp.styleProps;
    resolved.push({
      id:              `${idPfx}::comp::${comp.id}`,
      type:            comp.componentType,
      x: comp.x, y: comp.y,
      width: comp.width, height: comp.height,
      opacity:         comp.opacity,
      _isComponentBase: true,
      backgroundColor: sp.backgroundColor,
      textColor:       sp.textColor,
      textContent:     sp.textContent ?? "Text Overlay",
      fontSize:        sp.fontSize ?? 5,
      fontFamily:      sp.fontFamily ?? "sans-serif",
      fontWeight:      sp.fontWeight ?? "normal",
      fontStyle:       sp.fontStyle ?? "normal",
      visualizerType:  sp.visualizerType ?? "bars",
      barColor:        sp.barColor,
      progressColor:   sp.progressColor,
      maxMessages:     sp.maxMessages ?? 10,
      title:           "Now Playing",
      artist:          "Artist",
      duration:        0,
    });

    // Decorations: component-relative (0-100% of comp bounds) → canvas-relative
    for (const dec of comp.decorations ?? []) {
      const decCanvasX = comp.x + (dec.x  / 100) * comp.width;
      const decCanvasY = comp.y + (dec.y  / 100) * comp.height;
      const decCanvasW =          (dec.width  / 100) * comp.width;
      const decCanvasH =          (dec.height / 100) * comp.height;
      resolved.push(
        resolveThemeElement(dec, `${idPfx}::comp::${comp.id}::dec`, layout, vars, {
          x: decCanvasX, y: decCanvasY,
          width: decCanvasW, height: decCanvasH,
        }),
      );
    }
  }

  return resolved;
}

export function OverlayThemeNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const updateNodeData = useSetAtom(updateNodeDataAtom);

  const [themes, setThemes] = useState<OverlayThemeMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const selectedThemeId = (node.data.selectedThemeId as string | null) ?? null;
  const variables = (node.data.variables as Record<string, string>) ?? {};
  const themeLayout = (node.data.themeLayout as OverlayThemeLayout | null) ?? null;

  const [draftVars, setDraftVars] = useState<Record<string, string>>(variables);
  const prevSelectedId = useRef<string | null>(null);

  // Reload theme list on mount
  useEffect(() => {
    window.electron.getInstalledOverlayThemes().then(setThemes).catch(console.error);
  }, []);

  // When selected theme changes, load its layout and resolve elements
  useEffect(() => {
    if (!selectedThemeId || selectedThemeId === prevSelectedId.current) return;
    prevSelectedId.current = selectedThemeId;
    setLoading(true);
    window.electron.loadOverlayTheme(selectedThemeId).then((layout) => {
      if (!layout) { setLoading(false); return; }
      const initialVars: Record<string, string> = {};
      for (const v of layout.variables) {
        initialVars[v.key] = variables[v.key] ?? v.default ?? "";
      }
      const resolved = resolveElements(layout, initialVars);
      setDraftVars(initialVars);
      updateNodeData({
        id: node.id,
        patch: {
          themeLayout: layout,
          variables: initialVars,
          resolvedElements: resolved,
        },
      });
      setLoading(false);
    }).catch((err) => {
      console.error("[OverlayThemeNode] Failed to load theme:", err);
      setLoading(false);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedThemeId]);

  const handleThemeSelect = useCallback((themeId: string) => {
    updateNodeData({ id: node.id, patch: { selectedThemeId: themeId, themeLayout: null, resolvedElements: [] } });
  }, [node.id, updateNodeData]);

  const handleInstall = useCallback(async () => {
    try {
      const paths = await window.electron.openFileDialog({
        properties: ["openFile"],
        filters: [{ name: "SonicPlank Theme", extensions: ["sptheme"] }],
      });
      if (!paths?.length) return;
      setInstalling(true);
      setErrorMsg(null);
      const result = await window.electron.installOverlayTheme(paths[0]);
      if ("error" in result) {
        setErrorMsg(result.error as string);
      } else {
        const refreshed = await window.electron.getInstalledOverlayThemes();
        setThemes(refreshed);
        handleThemeSelect(result.id as string);
      }
    } catch (err: any) {
      setErrorMsg(String(err?.message ?? err));
    } finally {
      setInstalling(false);
    }
  }, [handleThemeSelect]);

  const handleVarChange = useCallback((key: string, value: string) => {
    setDraftVars((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleApply = useCallback(() => {
    if (!themeLayout) return;
    const resolved = resolveElements(themeLayout, draftVars);
    updateNodeData({ id: node.id, patch: { variables: draftVars, resolvedElements: resolved } });
  }, [themeLayout, draftVars, node.id, updateNodeData]);

  const varsAreDirty = themeLayout
    ? themeLayout.variables.some((v) => draftVars[v.key] !== (variables[v.key] ?? v.default ?? ""))
    : false;

  const selectedMeta = themes.find((t) => t.id === selectedThemeId);

  return (
    <>
      <BaseNodeCard
        id={node.id}
        selected={node.selected}
        isMinimized={!!node.data.isMinimized}
        borderColor="purple"
        iconColor="purple"
        icon={PaletteIcon}
        title="Overlay Theme"
        subtitle="Apply a packaged overlay theme"
        anchorName={`--overlayThemeNode_${node.id}`}
      >
        <div className="flex flex-col gap-3 nodrag nopan nowheel">

          {/* Theme selector + install */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                Installed Theme
              </label>
              <button
                onClick={handleInstall}
                disabled={installing}
                title="Install .sptheme archive"
                className="flex items-center gap-1 px-2 py-0.5 text-[9px] font-semibold bg-violet-600/20 hover:bg-violet-600/40 border border-violet-500/30 text-violet-300 rounded cursor-pointer transition-colors disabled:opacity-50"
              >
                <UploadIcon className="w-2.5 h-2.5" />
                {installing ? "Installing…" : "Install"}
              </button>
            </div>

            {themes.length === 0 ? (
              <div className="text-[10px] text-muted-foreground italic py-1">
                No themes installed. Click Install to add a .sptheme file.
              </div>
            ) : (
              <select
                value={selectedThemeId ?? ""}
                onChange={(e) => e.target.value && handleThemeSelect(e.target.value)}
                className="w-full bg-muted border border-border rounded px-2 py-1.5 text-xs text-foreground focus:border-violet-500 focus:outline-none"
              >
                <option value="">— Select a theme —</option>
                {themes.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            )}

            {errorMsg && (
              <div className="text-[10px] text-red-400 mt-0.5">{errorMsg}</div>
            )}
          </div>

          {/* Preview image */}
          {selectedMeta?.previewImagePath && (
            <div className="rounded overflow-hidden border border-border/40">
              <img
                src={`file:///${selectedMeta.previewImagePath.replace(/\\/g, "/")}`}
                alt="Theme preview"
                className="w-full object-cover max-h-24"
              />
            </div>
          )}

          {/* Theme description */}
          {themeLayout?.description && (
            <div className="text-[10px] text-muted-foreground leading-relaxed border-t border-border/30 pt-2">
              {themeLayout.description}
            </div>
          )}

          {/* Loading indicator */}
          {loading && (
            <div className="text-[10px] text-violet-400 animate-pulse">Loading theme…</div>
          )}

          {/* Variable inputs */}
          {themeLayout && themeLayout.variables.length > 0 && (
            <div className="flex flex-col gap-2 border-t border-border/40 pt-2.5">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                Theme Variables
              </label>
              {themeLayout.variables.map((v) => (
                <div key={v.key} className="flex flex-col gap-0.5">
                  <label className="text-[9px] text-muted-foreground">{v.label}</label>
                  <input
                    type="text"
                    value={draftVars[v.key] ?? ""}
                    placeholder={v.default}
                    onChange={(e) => handleVarChange(v.key, e.target.value)}
                    className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:border-violet-500 focus:outline-none"
                  />
                </div>
              ))}
            </div>
          )}

          {/* Apply button */}
          {(varsAreDirty || (themeLayout && !node.data.resolvedElements)) && (
            <button
              onClick={handleApply}
              className="w-full py-1.5 bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold rounded cursor-pointer transition-colors mt-1"
            >
              Apply
            </button>
          )}
        </div>
      </BaseNodeCard>

      <Handle
        id={`handle_${node.id}_source`}
        type="source"
        position={Position.Right}
        isConnectable={node.isConnectable}
        style={{ top: "34px" }}
        className="hover:border-violet-400! hover:shadow-[0_0_10px_rgba(167,139,250,0.5)]! hover:scale-125!"
      />
    </>
  );
}
