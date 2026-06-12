import type { NodeBase } from "@xyflow/system";

export type FlowNodeType<
  NodeData extends Record<string, unknown> = Record<string, unknown>,
  NodeType extends string | undefined = string | undefined,
> = NodeBase<NodeData, NodeType> & {
  data: {
    title?: string;
    artist?: string;
    mediaPath?: string;
    volume?: number;
    duration?: number;
    captureSourceId?: string;
    captureSourceName?: string;
    captureType?: string;
    captureAudio?: boolean;
  };
  type?: string;
};
