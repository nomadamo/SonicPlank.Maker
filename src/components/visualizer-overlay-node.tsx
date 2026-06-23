import { BaseNodeCard } from "./base-node";
import { Handle, NodeProps, Position, useNodes } from "@xyflow/react";
import { Activity as ActivityIcon } from "lucide-react";
import { FlowNodeType } from "@/types/flow-node";
import { useSetAtom } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import { useCallback, useEffect, useMemo, useState } from "react";
import { isValidConnection as validateConnection } from "@/utils/flow-connections";
import { CustomColorPicker } from "@/components/ui/custom-color-picker";

const DEFAULTS = {
  x: 10,
  y: 70,
  width: 80,
  height: 20,
  opacity: 1,
  backgroundColor: "rgba(0, 0, 0, 0.3)",
  visualizerType: "bars",
};

function fromNodeData(data: FlowNodeType["data"]) {
  return {
    x: data.x !== undefined ? Number(data.x) : DEFAULTS.x,
    y: data.y !== undefined ? Number(data.y) : DEFAULTS.y,
    width: data.width !== undefined ? Number(data.width) : DEFAULTS.width,
    height: data.height !== undefined ? Number(data.height) : DEFAULTS.height,
    opacity: data.opacity !== undefined ? Number(data.opacity) : DEFAULTS.opacity,
    backgroundColor: (data.backgroundColor as string) ?? DEFAULTS.backgroundColor,
    visualizerType: (data.visualizerType as string) ?? DEFAULTS.visualizerType,
  };
}

export function VisualizerOverlayNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const updateNodeData = useSetAtom(updateNodeDataAtom);
  const nodes = useNodes();

  const isValidConnection = useCallback(
    (connection: any) => validateConnection(connection, nodes),
    [nodes]
  );

  useEffect(() => {
    if (node.data.x === undefined) {
      updateNodeData({ id: node.id, patch: DEFAULTS });
    }
  }, [node.id, node.data.x, updateNodeData]);

  const handleUpdate = useCallback(
    (patch: Partial<FlowNodeType["data"]>) => {
      updateNodeData({ id: node.id, patch });
    },
    [node.id, updateNodeData]
  );

  const [draft, setDraft] = useState(() => fromNodeData(node.data));
  const committed = useMemo(() => fromNodeData(node.data), [node.data]);

  useEffect(() => {
    setDraft(fromNodeData(node.data));
  }, [node.data]);

  const isDirty = (Object.keys(draft) as Array<keyof typeof draft>).some(
    (k) => draft[k] !== committed[k]
  );

  const set = useCallback(<K extends keyof typeof draft>(key: K, value: typeof draft[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleApply = useCallback(() => {
    handleUpdate(draft);
  }, [draft, handleUpdate]);

  return (
    <>
      <BaseNodeCard
        id={node.id}
        selected={node.selected}
        isMinimized={!!node.data.isMinimized}
        borderColor="cyan"
        iconColor="cyan"
        icon={ActivityIcon}
        title="Audio Visualizer"
        subtitle="Layer frequency bars"
        anchorName={`--visualizerOverlayNode_${node.id}`}
      >
        <div className="flex flex-col gap-3 nodrag nopan nowheel">
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Position X (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={draft.x}
                onChange={(e) => set("x", Number(e.target.value) || 0)}
                className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Position Y (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={draft.y}
                onChange={(e) => set("y", Number(e.target.value) || 0)}
                className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Width (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={draft.width}
                onChange={(e) => set("width", Number(e.target.value) || 0)}
                className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Height (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={draft.height}
                onChange={(e) => set("height", Number(e.target.value) || 0)}
                className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Opacity</label>
              <span className="text-[10px] text-muted-foreground">{Math.round(draft.opacity * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={draft.opacity}
              onChange={(e) => set("opacity", Number(e.target.value))}
              className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
            />
          </div>

          <div className="flex flex-col gap-1 border-t border-border/40 pt-2.5">
            <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Visualizer Style</label>
            <select
              value={draft.visualizerType}
              onChange={(e) => set("visualizerType", e.target.value)}
              className="w-full bg-muted border border-border rounded px-2.5 py-1.5 text-xs text-foreground focus:border-indigo-500 focus:outline-none cursor-pointer"
            >
              <option value="bars">Frequency Bars</option>
              <option value="wave">Time-domain Wave (Oscilloscope)</option>
              <option value="circle">Circular Ring</option>
              <option value="blocks">LED Segments / Blocks</option>
              <option value="dots">Bouncing Dots</option>
            </select>
          </div>

          <div className="flex flex-col gap-1 border-t border-border/40 pt-2.5">
            <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">Background Color</label>
            <div className="flex gap-1.5 items-center">
              <CustomColorPicker
                value={draft.backgroundColor}
                onChange={(val) => set("backgroundColor", val)}
              />
              <input
                type="text"
                value={draft.backgroundColor}
                onChange={(e) => set("backgroundColor", e.target.value)}
                className="w-full bg-muted border border-border rounded px-2.5 py-1.5 text-xs text-foreground focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {isDirty && (
            <button
              onClick={handleApply}
              className="w-full py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded cursor-pointer transition-colors mt-1"
            >
              Apply
            </button>
          )}
        </div>
      </BaseNodeCard>
      <Handle
        id={`handle_${node.id}_target`}
        type="target"
        position={Position.Left}
        isConnectable={node.isConnectable}
        isValidConnection={isValidConnection}
        style={{ top: "34px" }}
        className="hover:!border-cyan-400 hover:!shadow-[0_0_10px_rgba(34,211,238,0.5)] hover:!scale-125"
      />
      <Handle
        id={`handle_${node.id}_source`}
        type="source"
        position={Position.Right}
        isConnectable={node.isConnectable}
        style={{ top: "34px" }}
        className="hover:!border-cyan-400 hover:!shadow-[0_0_10px_rgba(34,211,238,0.5)] hover:!scale-125"
      />
    </>
  );
}
