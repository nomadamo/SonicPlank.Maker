import { BaseNodeCard } from "./base-node";
import { cn } from "@/lib/utils";
import { Handle, NodeProps, Position, useNodes, useEdges } from "@xyflow/react";
import {
  Layers as LayersIcon,
  ArrowLeftRight as SwapIcon,
} from "lucide-react";
import { FlowNodeType } from "@/types/flow-node";
import { useMemo, useCallback } from "react";
import { isValidConnection as validateConnection } from "@/utils/flow-connections";
import { useAtom, useSetAtom } from "jotai";
import { flowNodesAtom, updateNodeDataAtom } from "@/store/flowStore";
import { SortableList, SortableItem, SortableDragHandle } from "@/components/ui/sortable-list";

const OVERLAY_NODE_TYPES = [
  "textOverlayNode",
  "colorOverlayNode",
  "imageOverlayNode",
  "visualizerOverlayNode",
  "nowPlayingNode",
  "twitchChatNode",
];

interface SourceRole {
  role: "primary" | "pip";
  pipX: number;
  pipY: number;
  pipW: number;
  pipH: number;
}

export function OverlayGroupNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const nodes = useNodes();
  const edges = useEdges();
  const [flowNodes, setFlowNodes] = useAtom(flowNodesAtom);
  const updateNodeData = useSetAtom(updateNodeDataAtom);

  const isValidConnection = useCallback(
    (connection: any) => validateConnection(connection, nodes),
    [nodes],
  );

  const storedSourceRoles = useMemo(
    () => ((node.data.sourceRoles as Record<string, SourceRole>) || {}),
    [node.data.sourceRoles],
  );

  // Incoming capture source nodes
  const connectedCaptureSources = useMemo(() => {
    return edges
      .filter((e) => e.target === node.id)
      .map((e) => nodes.find((n) => n.id === e.source && n.type === "captureSourceNode"))
      .filter(Boolean) as FlowNodeType[];
  }, [edges, nodes, node.id]);

  // Incoming overlay nodes
  const connectedOverlays = useMemo(() => {
    return edges
      .filter((e) => e.target === node.id)
      .map((e) => nodes.find((n) => n.id === e.source && OVERLAY_NODE_TYPES.includes(n?.type || "")))
      .filter(Boolean)
      .sort((a, b) => (a as FlowNodeType).position.y - (b as FlowNodeType).position.y) as FlowNodeType[];
  }, [edges, nodes, node.id]);

  // Merge stored roles with defaults for any newly connected sources.
  // First connected source with no stored role becomes primary; rest are pip.
  const effectiveRoles = useMemo<Record<string, SourceRole>>(() => {
    const result: Record<string, SourceRole> = {};
    let hasPrimary = connectedCaptureSources.some(
      (s) => storedSourceRoles[s.id]?.role === "primary",
    );
    for (const source of connectedCaptureSources) {
      const stored = storedSourceRoles[source.id];
      if (stored) {
        result[source.id] = stored;
      } else if (!hasPrimary) {
        result[source.id] = { role: "primary", pipX: 0, pipY: 0, pipW: 100, pipH: 100 };
        hasPrimary = true;
      } else {
        result[source.id] = { role: "pip", pipX: 70, pipY: 70, pipW: 25, pipH: 14 };
      }
    }
    return result;
  }, [connectedCaptureSources, storedSourceRoles]);

  const setSourceRole = useCallback(
    (sourceNodeId: string, role: "primary" | "pip") => {
      const next = { ...storedSourceRoles };
      if (role === "primary") {
        // Demote any existing primary (stored or auto-assigned) to pip
        for (const src of connectedCaptureSources) {
          if (src.id !== sourceNodeId && effectiveRoles[src.id]?.role === "primary") {
            next[src.id] = { ...effectiveRoles[src.id], role: "pip" };
          }
        }
      }
      next[sourceNodeId] = { ...effectiveRoles[sourceNodeId], role };
      updateNodeData({ id: node.id, patch: { sourceRoles: next } });
    },
    [storedSourceRoles, effectiveRoles, connectedCaptureSources, node.id, updateNodeData],
  );

  const updatePipPosition = useCallback(
    (sourceNodeId: string, patch: Partial<Pick<SourceRole, "pipX" | "pipY" | "pipW" | "pipH">>) => {
      const next = { ...storedSourceRoles };
      next[sourceNodeId] = { ...effectiveRoles[sourceNodeId], ...patch };
      updateNodeData({ id: node.id, patch: { sourceRoles: next } });
    },
    [storedSourceRoles, effectiveRoles, node.id, updateNodeData],
  );

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
        subtitle="Manages sources and overlay layers"
        anchorName={`--overlayGroupNode_${node.id}`}
      >
        {/* ── Capture Sources ─────────────────────────────────────── */}
        {connectedCaptureSources.length > 0 && (
          <div className="flex flex-col gap-1.5 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800/40 nodrag nopan nowheel">
            <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-0.5 select-none">
              Capture Sources
            </span>
            {connectedCaptureSources.map((source) => {
              const role = effectiveRoles[source.id];
              const isPip = role?.role === "pip";
              const sourceName =
                (source.data.captureSourceName as string) ||
                (source.data.captureSourceId as string) ||
                "Unknown Source";

              return (
                <div
                  key={source.id}
                  className="flex flex-col gap-1 border-b border-zinc-800/40 last:border-0 pb-2 last:pb-0"
                >
                  <div className="flex items-center gap-1.5">
                    <span className="text-[11px] text-zinc-300 truncate flex-1 min-w-0">
                      {sourceName}
                    </span>
                    <div className="flex items-center gap-0.5 rounded-md bg-zinc-900 border border-zinc-800 p-0.5 shrink-0">
                      {(["primary", "pip"] as const).map((r) => (
                        <button
                          key={r}
                          onClick={() => setSourceRole(source.id, r)}
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider transition-colors cursor-pointer",
                            role?.role === r
                              ? "bg-indigo-500/20 text-indigo-300"
                              : "text-zinc-500 hover:text-zinc-300",
                          )}
                        >
                          {r === "primary" ? "Main" : "PiP"}
                        </button>
                      ))}
                    </div>
                    {connectedCaptureSources.length > 1 && (
                      <button
                        title="Swap: make this the primary source"
                        onClick={() => setSourceRole(source.id, "primary")}
                        className="p-0.5 rounded text-zinc-500 hover:text-indigo-300 transition-colors cursor-pointer"
                      >
                        <SwapIcon className="w-3 h-3" />
                      </button>
                    )}
                  </div>

                  {isPip && (
                    <div className="grid grid-cols-4 gap-1 mt-0.5 pl-0.5">
                      {(
                        [
                          ["X", "pipX"],
                          ["Y", "pipY"],
                          ["W", "pipW"],
                          ["H", "pipH"],
                        ] as const
                      ).map(([label, key]) => (
                        <div key={key} className="flex flex-col gap-0.5">
                          <span className="text-[8px] text-zinc-600 uppercase tracking-wider">
                            {label}
                          </span>
                          <div className="flex items-center gap-0.5">
                            <input
                              type="number"
                              min={0}
                              max={100}
                              step={1}
                              value={role?.[key] ?? 0}
                              onChange={(e) =>
                                updatePipPosition(source.id, {
                                  [key]: Number(e.target.value),
                                })
                              }
                              className="w-full text-[10px] bg-zinc-950 border border-zinc-700 rounded px-1 py-0.5 text-zinc-200 nodrag nopan nowheel"
                            />
                            <span className="text-[8px] text-zinc-600">%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Overlay Layers ───────────────────────────────────────── */}
        <div className="flex flex-col gap-1.5 p-3 rounded-lg bg-zinc-900/50 border border-zinc-800/40 nodrag nopan nowheel">
          <span className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider mb-0.5 select-none">
            Layers (Bottom → Top)
          </span>
          {connectedOverlays.length === 0 ? (
            <div className="text-[11px] text-zinc-500 italic py-1 select-none">
              No overlay layers connected.
            </div>
          ) : (
            <SortableList
              items={connectedOverlays}
              onChange={(reorderedItems) => {
                const yCoords = [...connectedOverlays]
                  .map((o) => o.position.y)
                  .sort((a, b) => a - b);
                const nextNodes = flowNodes.map((graphNode) => {
                  const newIndex = reorderedItems.findIndex(
                    (item) => item.id === graphNode.id,
                  );
                  if (newIndex !== -1) {
                    return {
                      ...graphNode,
                      position: { ...graphNode.position, y: yCoords[newIndex] },
                    };
                  }
                  return graphNode;
                });
                setFlowNodes(nextNodes);
              }}
              renderItem={(item) => {
                let descriptor = "";
                let typeLabel = "";
                const data = item.data as any;
                if (item.type === "textOverlayNode") {
                  typeLabel = "Text";
                  descriptor = `"${data.textContent || "Watermark"}"`;
                } else if (item.type === "colorOverlayNode") {
                  typeLabel = "Color";
                  descriptor = data.backgroundColor || "#4f46e5";
                } else if (item.type === "imageOverlayNode") {
                  typeLabel = "Image";
                  descriptor = data.imagePath
                    ? String(data.imagePath).split(/[/\\]/).pop() || ""
                    : "None";
                } else if (item.type === "visualizerOverlayNode") {
                  typeLabel = "Visualizer";
                  descriptor = "Frequency Spectrum";
                } else if (item.type === "nowPlayingNode") {
                  typeLabel = "Now Playing";
                  descriptor = "Audio metadata";
                } else if (item.type === "twitchChatNode") {
                  typeLabel = "Twitch Chat";
                  descriptor = data.channel
                    ? `#${String(data.channel).replace(/^#/, "")}`
                    : "Not connected";
                }

                return (
                  <SortableItem
                    id={item.id}
                    className="nodrag nopan nowheel select-none"
                  >
                    <div className="flex w-full items-center justify-between text-[11px] text-zinc-300 py-1.5 border-b border-zinc-800/40 last:border-0 hover:bg-zinc-900/40 px-1 rounded transition-colors group">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <SortableDragHandle />
                        <span className="font-medium truncate">{typeLabel}</span>
                      </div>
                      <span className="text-zinc-500 max-w-[120px] truncate text-[10px] select-none pr-1">
                        {descriptor}
                      </span>
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
