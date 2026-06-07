import { Card, CardHeader, CardMedia } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import moment from "moment";
import momentDurationFormatSetup from "moment-duration-format";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { InfoIcon } from "lucide-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
// import { useMemo } from "react";
import { AudioPlayer } from "./audioplayer";
import { FlowNodeType } from "@/types/flow-node";
// import { useFlowStore } from "@/store/flowStoreProvider";
import { AudioFlowNode } from "@/types/audio-flow-node";
import { useStateMachine } from "@/store/stateMachine";

export function AudioNode(NodeRef: NodeProps<FlowNodeType>) {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  momentDurationFormatSetup(moment);


  // const { getFlowNode } = useStateMachine();

  const node = NodeRef; //getFlowNode(NodeRef.id) as AudioFlowNode;

  // const mediaInfo = media[1];
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
              url: node.data.mediaPath,
              // fillParent: true,
              // barGap: 0,
              // barWidth: 1,
              mediaControls: true,
              autoCenter: true,
              waveColor: "#7f2dcc",
              dragToSeek: false,
              interact: false,
              progressColor: "#c194ec",
              // barHeight: 1,
              height: 90,
              autoplay: false,
              hideScrollbar: true,
              // plugins: plugins,
              container: `container_${node.id}`,
            }}
            initialvolume={node.data.volume || 1}
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
