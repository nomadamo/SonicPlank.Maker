import { BaseNodeCard } from "./base-node";
import { cn } from "@/lib/utils";
import { Handle, NodeProps, Position, useNodes, useEdges } from "@xyflow/react";
import { Layers as LayersIcon } from "lucide-react";
import { FlowNodeType } from "@/types/flow-node";
import { useMemo, useCallback } from "react";
import { isValidConnection as validateConnection } from "@/utils/flow-connections";
import { useAtom } from "jotai";
import { flowNodesAtom } from "@/store/flowStore";
import { SortableList, SortableItem, SortableDragHandle } from "@/components/ui/sortable-list";

export function OverlayGroupNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const nodes = useNodes();
  const edges = useEdges();
  const [flowNodes, setFlowNodes] = useAtom(flowNodesAtom);

  const isValidConnection = useCallback(
    (connection: any) => {
      return validateConnection(connection, nodes);
    },
    [nodes]
  );

  // Find incoming overlay nodes connected to this group
  const connectedOverlays = useMemo(() => {
    const incomingEdges = edges.filter((e) => e.target === node.id);
    return incomingEdges
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter((n): n is FlowNodeType => !!(n && ["textOverlayNode", "colorOverlayNode", "imageOverlayNode", "visualizerOverlayNode", "nowPlayingNode", "twitchChatNode"].includes(n.type || "")))
      .sort((a, b) => a.position.y - b.position.y);
  }, [edges, nodes, node.id]);

  return (
    <>
      <BaseNodeCard
        id={node.id}
        selected={node.selected}
        isMinimized={!!node.data.isMinimized}
        borderColor="indigo"
        iconColor="indigo"
        icon={LayersIcon}
        title="Overlay Compositor"
        subtitle="Consolidates visual overlay layers"
        anchorName={`--overlayGroupNode_${node.id}`}
      >

        {/* Layers List */}
        <div className="flex flex-col gap-1.5 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800/40 nodrag nopan nowheel">
          <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-0.5 select-none">
            Active Layers (Bottom to Top)
          </span>
          {connectedOverlays.length === 0 ? (
            <div className="text-[11px] text-zinc-500 italic py-1 select-none">
              No overlay subcomponents connected.
            </div>
          ) : (
            <SortableList
              items={connectedOverlays}
              onChange={(reorderedItems) => {
                // Determine sorted y coordinates of the original overlay list
                const yCoords = [...connectedOverlays]
                  .map((o) => o.position.y)
                  .sort((a, b) => a - b);
                
                // Map reordered item IDs to the sorted y coordinates
                const nextNodes = flowNodes.map((graphNode) => {
                  const newIndex = reorderedItems.findIndex((item) => item.id === graphNode.id);
                  if (newIndex !== -1) {
                    return {
                      ...graphNode,
                      position: {
                        ...graphNode.position,
                        y: yCoords[newIndex],
                      },
                    };
                  }
                  return graphNode;
                });
                
                setFlowNodes(nextNodes);
              }}
              renderItem={(item) => {
                let descriptor = "";
                let typeCapitalized = "";
                const data = item.data as any;
                if (item.type === "textOverlayNode") { descriptor = `"${data.textContent || "Watermark"}"`; typeCapitalized = "Text"; }
                else if (item.type === "colorOverlayNode") { descriptor = data.backgroundColor || "#4f46e5"; typeCapitalized = "Color"; }
                else if (item.type === "imageOverlayNode") { descriptor = data.imagePath ? String(data.imagePath).split(/[/\\]/).pop() || "" : "None"; typeCapitalized = "Image"; }
                else if (item.type === "visualizerOverlayNode") { descriptor = "Frequency Spectrum"; typeCapitalized = "Visualizer"; }
                else if (item.type === "nowPlayingNode") { descriptor = "Audio metadata"; typeCapitalized = "Now Playing"; }
                else if (item.type === "twitchChatNode") { descriptor = data.channel ? `#${String(data.channel).replace(/^#/, "")}` : "Not connected"; typeCapitalized = "Twitch Chat"; }

                return (
                  <SortableItem id={item.id} className="nodrag nopan nowheel select-none">
                    <div className="flex w-full items-center justify-between text-[11px] text-zinc-300 py-1.5 border-b border-zinc-800/40 last:border-0 hover:bg-zinc-900/40 px-1 rounded transition-colors group">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <SortableDragHandle />
                        <span className="font-medium truncate">{typeCapitalized}</span>
                      </div>
                      <span className="text-zinc-500 max-w-[120px] truncate text-[10px] select-none pr-1">{descriptor}</span>
                    </div>
                  </SortableItem>
                );
              }}
              className="flex flex-col gap-1 max-h-48 overflow-y-auto"
            />
          )}
        </div>
      </BaseNodeCard>
      <Handle
        id={`handle_${node.id}_target`}
        type="target"
        position={Position.Left}
        isConnectable={node.isConnectable}
        isValidConnection={isValidConnection}
        className="hover:border-indigo-400! hover:shadow-[0_0_10px_rgba(129,140,248,0.5)]! hover:scale-125!"
      />
      <Handle
        id={`handle_${node.id}_source`}
        type="source"
        position={Position.Right}
        isConnectable={node.isConnectable}
        className="hover:border-indigo-400! hover:shadow-[0_0_10px_rgba(129,140,248,0.5)]! hover:scale-125!"
      />
    </>
  );
}
