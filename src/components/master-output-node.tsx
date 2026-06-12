import { Card, CardHeader, CardMedia } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { SpeakerIcon } from "lucide-react";
import { FlowNodeType } from "@/types/flow-node";

export function MasterOutputNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;

  return (
    <>
      <Card
        className={cn("w-100 panel")}
        id={`flow-node-${node.id}`}
        style={{ anchorName: `--masterOutputNode_${node.id}` }}
      >
        <CardMedia variant="icon">
          <SpeakerIcon />
        </CardMedia>
        <CardHeader
          title="Master Output"
          description="Route audio nodes here"
        ></CardHeader>
      </Card>
      <Handle
        id={`handle_${node.id}_target`}
        type="target"
        position={Position.Left}
        isConnectable={true}
      />
    </>
  );
}
