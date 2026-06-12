import { FlowNodeType } from "./flow-node";

export type AudioFlowNode = FlowNodeType & {
  data: {
    artist?: string;
  };
  type?: string;
};
