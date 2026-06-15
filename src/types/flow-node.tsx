import type { NodeBase } from "@xyflow/system";

export interface NodeTrigger {
  id: string;
  triggerKey: string; // e.code, e.g. "Space", "KeyM"
  action: string;      // Action name, e.g. "togglePlay"
}

export interface OverlayElement {
  id: string;
  type: "text" | "color" | "image" | "visualizer" | "nowPlaying";
  x: number; // percentage coordinate (0-100) for scaling
  y: number; // percentage coordinate (0-100) for scaling
  width: number; // percentage width (0-100)
  height: number; // percentage height (0-100)
  opacity: number; // 0-1
  textContent?: string;
  fontSize?: number;
  textColor?: string;
  backgroundColor?: string;
  imagePath?: string;
  visualizerType?: string; // "bars" | "wave" | "circle" | "blocks" | "dots"
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  albumArt?: string;
  title?: string;
  artist?: string;
  audioNodeId?: string;
  duration?: number;
}

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
    captureResolution?: string;
    overlays?: OverlayElement[];
    albumArt?: string;
    // New states and configurations for triggers & visualizers
    visualizerType?: string;
    triggers?: NodeTrigger[];
    isPlaying?: boolean;
    isMuted?: boolean;
    isPreviewActive?: boolean;
    isRecording?: boolean;
    isStreaming?: boolean;
  };
  type?: string;
};
