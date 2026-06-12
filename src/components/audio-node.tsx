import { Card, CardHeader, CardMedia } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { InfoIcon } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { AudioPlayer } from "./audioplayer";
import { FlowNodeType } from "@/types/flow-node";
import { useSetAtom } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import { useCallback } from "react";

export function AudioNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const updateNodeData = useSetAtom(updateNodeDataAtom);

  const handleVolumeChange = useCallback(
    (volume: number) => {
      updateNodeData({ id: node.id, patch: { volume } });
    },
    [node.id, updateNodeData],
  );

  return (
    <>
      <Card
        className={cn("w-100 panel")}
        id={`flow-node-${node.id}`}
        style={{ anchorName: `--audioNode_${node.id}` }}
      >
        <CardMedia variant="icon">
          <Tooltip>
            <TooltipTrigger>
              <InfoIcon />
            </TooltipTrigger>
            <TooltipContent>{node.data.mediaPath}</TooltipContent>
          </Tooltip>
        </CardMedia>
        <CardHeader
          description={node.data.artist}
          title={node.data.title}
        ></CardHeader>
        <AudioPlayer
          id={node.id}
          options={{
            url: node.data.mediaPath?.startsWith("file:///")
              ? node.data.mediaPath
              : "file:///" + node.data.mediaPath,
            mediaControls: false,
            waveColor: "#7f2dcc",
            dragToSeek: false,
            interact: false,
            progressColor: "#c194ec",
            autoplay: false,
            hideScrollbar: true,
            normalize: false,
            fillParent: true,
            container: `container_${node.id}`,
            barMinHeight: 80,
            height: 73,
          }}
          initialvolume={node.data.volume ?? 1}
          onVolumeChange={handleVolumeChange}
        />
      </Card>
      <Handle
        id={`handle_${node.id}_target`}
        type="target"
        position={Position.Left}
        isConnectable={true}
        onConnect={(params) => console.log("handle onConnect", params)}
      />
      <Handle
        id={`handle_${node.id}_source`}
        type="source"
        position={Position.Right}
        isConnectable={true}
        onConnect={(params) => console.log("handle onConnect", params)}
      />
    </>
  );
}
