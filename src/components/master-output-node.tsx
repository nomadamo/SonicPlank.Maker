import { BaseNodeCard } from "./base-node";
import { cn } from "@/lib/utils";
import { Handle, NodeProps, Position, useNodes } from "@xyflow/react";
import { Speaker as SpeakerIcon } from "lucide-react";
import { FlowNodeType } from "@/types/flow-node";
import { useCallback } from "react";
import { isValidConnection as validateConnection } from "@/utils/flow-connections";

export function MasterOutputNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const nodes = useNodes();

  const isValidConnection = useCallback(
    (connection: any) => {
      return validateConnection(connection, nodes);
    },
    [nodes]
  );

  return (
    <>
      <BaseNodeCard
        id={node.id}
        selected={node.selected}
        isMinimized={!!node.data.isMinimized}
        borderColor="red"
        iconColor="red"
        icon={SpeakerIcon}
        title="Master Output"
        subtitle="Route audio nodes here"
        anchorName={`--masterOutputNode_${node.id}`}
      />
      <Handle
        id={`handle_${node.id}_target`}
        type="target"
        position={Position.Left}
        isConnectable={node.isConnectable}
        isValidConnection={isValidConnection}
        className="hover:!border-red-400 hover:!shadow-[0_0_10px_rgba(248,113,113,0.5)] hover:!scale-125"
      />
    </>
  );
}

