import { BaseNodeCard } from "./base-node";
import { cn } from "@/lib/utils";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { Image as ImageIcon } from "lucide-react";
import { FlowNodeType } from "@/types/flow-node";
import { useSetAtom } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import { useCallback, useEffect } from "react";

export function ImageOverlayNode(NodeRef: NodeProps<FlowNodeType>) {
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
          width: 30,
          height: 20,
          opacity: 1,
          imagePath: "",
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

  const handleSelectImage = useCallback(async () => {
    try {
      const filePaths = await window.electron.openFileDialog({
        properties: ["openFile"],
        filters: [
          {
            name: "Image Files",
            extensions: ["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"],
          },
        ],
      });
      if (filePaths && filePaths.length > 0) {
        handleUpdate({ imagePath: filePaths[0] });
      }
    } catch (err) {
      console.error("[ImageOverlayNode] Failed to select image:", err);
    }
  }, [handleUpdate]);

  const xVal = node.data.x !== undefined ? Number(node.data.x) : 10;
  const yVal = node.data.y !== undefined ? Number(node.data.y) : 10;
  const wVal = node.data.width !== undefined ? Number(node.data.width) : 30;
  const hVal = node.data.height !== undefined ? Number(node.data.height) : 20;
  const opacityVal = node.data.opacity !== undefined ? Number(node.data.opacity) : 1;
  const imagePath = (node.data.imagePath as string) || "";

  return (
    <>
      <BaseNodeCard
        id={node.id}
        selected={node.selected}
        isMinimized={!!node.data.isMinimized}
        borderColor="indigo"
        iconColor="emerald"
        icon={ImageIcon}
        title="Image Overlay"
        subtitle="Layer image watermark"
        anchorName={`--imageOverlayNode_${node.id}`}
      >

        {/* Image Settings Form */}
        <div className="flex flex-col gap-3 nodrag nopan nowheel">
          {/* Coordinates Grid */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider">Position X (%)</label>
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
              <label className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider">Position Y (%)</label>
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
              <label className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider">Width (%)</label>
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
              <label className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider">Height (%)</label>
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

          {/* Image File Selector */}
          <div className="flex flex-col gap-2 border-t border-zinc-800/40 pt-2.5">
            <label className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">Image File</label>
            <div className="flex gap-1.5">
              <input
                type="text"
                readOnly
                value={imagePath}
                className="flex-1 bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-400 select-all overflow-hidden text-ellipsis whitespace-nowrap text-left"
                placeholder="Select image file..."
                title={imagePath}
              />
              <button
                onClick={handleSelectImage}
                className="px-3 py-1.5 bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-zinc-300 text-xs font-medium rounded cursor-pointer transition-colors"
              >
                Browse
              </button>
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
