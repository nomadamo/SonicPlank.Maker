import { BaseNodeCard } from "./base-node";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { Palette as PaletteIcon } from "lucide-react";
import { FlowNodeType, OverlayThemeMeta, OverlayThemeLayout, OverlayElement } from "@/types/flow-node";
import { useSetAtom } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import { useCallback, useEffect, useRef, useState } from "react";
import { resolveThemeElements } from "@/utils/resolve-theme";

export function OverlayThemeNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const updateNodeData = useSetAtom(updateNodeDataAtom);

  const [themes, setThemes] = useState<OverlayThemeMeta[]>([]);
  const [loading, setLoading] = useState(false);

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
      const resolved = resolveThemeElements(layout, initialVars);
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

  const handleVarChange = useCallback((key: string, value: string) => {
    setDraftVars((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleApply = useCallback(() => {
    if (!themeLayout) return;
    const resolved = resolveThemeElements(themeLayout, draftVars);
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

          {/* Theme selector */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
              Theme
            </label>
            {themes.length === 0 ? (
              <div className="text-[10px] text-muted-foreground italic py-1">
                No themes installed. Add one in Settings → Themes.
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
