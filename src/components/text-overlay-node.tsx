import { BaseNodeCard } from "./base-node";
import { cn } from "@/lib/utils";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { Type as TypeIcon } from "lucide-react";
import { FlowNodeType } from "@/types/flow-node";
import { useSetAtom } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import { useCallback, useEffect } from "react";
import { CustomColorPicker } from "@/components/ui/custom-color-picker";

export function TextOverlayNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const updateNodeData = useSetAtom(updateNodeDataAtom);

  // Initialize data defaults if they don't exist
  useEffect(() => {
    if (node.data.x === undefined) {
      updateNodeData({
        id: node.id,
        patch: {
          x: 10,
          y: 10,
          width: 40,
          height: 10,
          opacity: 1,
          textContent: "Watermark Text",
          fontSize: 5,
          textColor: "#ffffff",
          fontFamily: "Inter, sans-serif",
          fontWeight: "normal",
          fontStyle: "normal",
        },
      });
    }
  }, [node.id, node.data.x, updateNodeData]);

  const handleUpdate = useCallback(
    (patch: Partial<FlowNodeType["data"]>) => {
      updateNodeData({ id: node.id, patch });
    },
    [node.id, updateNodeData]
  );

  const xVal = node.data.x !== undefined ? Number(node.data.x) : 10;
  const yVal = node.data.y !== undefined ? Number(node.data.y) : 10;
  const wVal = node.data.width !== undefined ? Number(node.data.width) : 40;
  const hVal = node.data.height !== undefined ? Number(node.data.height) : 10;
  const opacityVal = node.data.opacity !== undefined ? Number(node.data.opacity) : 1;
  const textContent = (node.data.textContent as string) || "";
  const fontSize = node.data.fontSize !== undefined ? Number(node.data.fontSize) : 5;
  const textColor = (node.data.textColor as string) || "#ffffff";
  const fontFamily = (node.data.fontFamily as string) || "Inter, sans-serif";
  const fontWeight = (node.data.fontWeight as string) || "normal";
  const fontStyle = (node.data.fontStyle as string) || "normal";

  return (
    <>
      <BaseNodeCard
        id={node.id}
        selected={node.selected}
        isMinimized={!!node.data.isMinimized}
        borderColor="indigo"
        iconColor="indigo"
        icon={TypeIcon}
        title="Text Overlay"
        subtitle="Layer text watermark"
        anchorName={`--textOverlayNode_${node.id}`}
      >

        {/* Text Settings Form */}
        <div className="flex flex-col gap-3 nodrag nopan nowheel">
          {/* Text Content */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
              Text Content
            </label>
            <input
              type="text"
              value={textContent}
              onChange={(e) => handleUpdate({ textContent: e.target.value })}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
              placeholder="Live text watermark"
            />
          </div>

          {/* Coordinates Grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">Position X (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={xVal}
                onChange={(e) => handleUpdate({ x: Number(e.target.value) || 0 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">Position Y (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={yVal}
                onChange={(e) => handleUpdate({ y: Number(e.target.value) || 0 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">Width (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={wVal}
                onChange={(e) => handleUpdate({ width: Number(e.target.value) || 0 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">Height (%)</label>
              <input
                type="number"
                min="0"
                max="100"
                value={hVal}
                onChange={(e) => handleUpdate({ height: Number(e.target.value) || 0 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Opacity Slider */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center">
              <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">Opacity</label>
              <span className="text-[10px] text-zinc-400">{Math.round(opacityVal * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={opacityVal}
              onChange={(e) => handleUpdate({ opacity: Number(e.target.value) })}
              className="w-full h-1 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
            />
          </div>

          {/* Font Size and Color */}
          <div className="grid grid-cols-2 gap-2 border-t border-zinc-800/40 pt-2.5">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">Font Size (%)</label>
              <input
                type="number"
                min="1"
                max="20"
                value={fontSize}
                onChange={(e) => handleUpdate({ fontSize: Number(e.target.value) || 1 })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">Color</label>
              <div className="flex gap-1.5 items-center">
                <CustomColorPicker
                  value={textColor}
                  onChange={(val) => handleUpdate({ textColor: val })}
                />
                <input
                  type="text"
                  value={textColor}
                  onChange={(e) => handleUpdate({ textColor: e.target.value })}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Font Family Dropdown */}
          <div className="flex flex-col gap-1 border-t border-zinc-800/40 pt-2.5">
            <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">Font Family</label>
            <select
              value={fontFamily}
              onChange={(e) => handleUpdate({ fontFamily: e.target.value })}
              className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none cursor-pointer"
            >
              <option value="Inter, sans-serif">Inter</option>
              <option value="Roboto, sans-serif">Roboto</option>
              <option value="Outfit, sans-serif">Outfit</option>
              <option value='"Playfair Display", serif'>Playfair Display</option>
              <option value='"Fira Code", monospace'>Fira Code</option>
              <option value="Georgia, serif">Georgia</option>
            </select>
          </div>

          {/* Font Weight & Style Row */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">Weight</label>
              <select
                value={fontWeight}
                onChange={(e) => handleUpdate({ fontWeight: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none cursor-pointer"
              >
                <option value="300">Light</option>
                <option value="normal">Regular</option>
                <option value="500">Medium</option>
                <option value="600">Semi-Bold</option>
                <option value="bold">Bold</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">Style</label>
              <select
                value={fontStyle}
                onChange={(e) => handleUpdate({ fontStyle: e.target.value })}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none cursor-pointer"
              >
                <option value="normal">Normal</option>
                <option value="italic">Italic</option>
              </select>
            </div>
          </div>
        </div>
      </BaseNodeCard>
      <Handle
        id={`handle_${node.id}_source`}
        type="source"
        position={Position.Right}
        isConnectable={node.isConnectable}
        className="hover:!border-indigo-400 hover:!shadow-[0_0_10px_rgba(129,140,248,0.5)] hover:!scale-125"
      />
    </>
  );
}
