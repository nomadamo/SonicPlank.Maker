import { NodeBase } from "@xyflow/system";

export type FlowNodeType<
  NodeData extends Record<string, unknown> = Record<string, unknown>,
  NodeType extends string | undefined = string | undefined,
> = NodeBase<NodeData, NodeType> & {
  data: {
    title?: string;
    mediaPath?: string;
    volume?: number;
  };
  type?: string;
};
