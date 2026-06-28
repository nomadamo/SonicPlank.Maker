import type { NodeBase } from "@xyflow/system";

export interface NodeTrigger {
  id: string;
  triggerKey: string; // e.code, e.g. "Space", "KeyM"
  action: string; // Action name, e.g. "togglePlay"
}

export interface OverlayThemeVariable {
  key: string;
  label: string;
  default: string;
}

export interface SceneTransition {
  durationMs: number;
}

export interface ThemeSourceSlot {
  id: string;
  role: "primary" | "pip";
  x: number;
  y: number;
  width: number;
  height: number;
  fitMode: "contain" | "cover" | "stretch";
  opacity: number;
}

export interface ThemeScene {
  id: string;
  name: string;
  hotkey?: string;
  transition: SceneTransition;
  elements: OverlayThemeElement[];
  components: OverlayThemeComponent[];
  sources: ThemeSourceSlot[];
}

export interface OverlayThemeElement {
  id: string;
  type: "image" | "text" | "color";
  asset?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  textContent?: string;
  fontSize?: number;
  textColor?: string;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  backgroundColor?: string;
}

export interface OverlayThemeMeta {
  id: string;
  name: string;
  author?: string;
  description?: string;
  previewImagePath?: string;
  themeDir: string;
}

export interface OverlayThemeLayout extends OverlayThemeMeta {
  variables: OverlayThemeVariable[];
  scenes: ThemeScene[];
}

export interface ComponentStyleProps {
  textContent?: string;
  fontSize?: number;
  textColor?: string;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  backgroundColor?: string;
  asset?: string;
  visualizerType?: string;
  barColor?: string;
  progressColor?: string;
  maxMessages?: number;
}

export interface OverlayThemeComponent {
  id: string;
  componentType: "text" | "color" | "image" | "visualizer" | "nowPlaying" | "twitchChat";
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  styleProps: ComponentStyleProps;
  decorations: OverlayThemeElement[];
}

export interface OverlayElement {
  id: string;
  type: "text" | "color" | "image" | "visualizer" | "nowPlaying" | "twitchChat";
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
  barColor?: string;
  progressColor?: string;
  fontFamily?: string;
  fontWeight?: string;
  fontStyle?: string;
  albumArt?: string;
  title?: string;
  artist?: string;
  audioNodeId?: string;
  duration?: number;
  maxMessages?: number;
  _isComponentBase?: boolean;
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
    audioDeviceId?: string;
    audioDeviceName?: string;
    captureType?: string;
    captureAudio?: boolean;
    captureResolution?: string;
    maxCaptureFrameRate?: number;
    // How the source is fit into a differently-shaped output canvas.
    fitMode?: "contain" | "cover" | "stretch";
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
