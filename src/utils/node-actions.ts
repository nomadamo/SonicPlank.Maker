import { FlowNodeType } from "@/types/flow-node";

export interface NodeAction {
  name: string;
  label: string;
  description: string;
}

export const NODE_ACTIONS: Record<string, NodeAction[]> = {
  audioFlowNode: [
    { name: "togglePlay", label: "Toggle Play", description: "Play or pause the audio track" },
    { name: "play", label: "Play", description: "Play the audio track" },
    { name: "pause", label: "Pause", description: "Pause the audio track" },
    { name: "stop", label: "Stop", description: "Stop the audio track and reset playhead" },
    { name: "toggleMute", label: "Toggle Mute", description: "Mute or unmute the audio" },
    { name: "volumeUp", label: "Volume Up (+10%)", description: "Increase volume level" },
    { name: "volumeDown", label: "Volume Down (-10%)", description: "Decrease volume level" },
  ],
  captureSourceNode: [
    { name: "toggleCapture", label: "Toggle Capture", description: "Start or stop screen/audio capture" },
    { name: "startCapture", label: "Start Capture", description: "Start screen/audio capture" },
    { name: "stopCapture", label: "Stop Capture", description: "Stop screen/audio capture" },
  ],
  targetOutputNode: [
    { name: "togglePreview", label: "Toggle Preview", description: "Start or stop compositor rendering preview" },
    { name: "toggleRecording", label: "Toggle Recording", description: "Start or stop recording target output" },
    { name: "toggleStreaming", label: "Toggle Streaming", description: "Start or stop RTMP stream output" },
  ],
  textOverlayNode: [
    { name: "toggleVisibility", label: "Toggle Visibility", description: "Show or hide the text overlay" },
  ],
  colorOverlayNode: [
    { name: "toggleVisibility", label: "Toggle Visibility", description: "Show or hide the color overlay" },
  ],
  imageOverlayNode: [
    { name: "toggleVisibility", label: "Toggle Visibility", description: "Show or hide the image overlay" },
  ],
  visualizerOverlayNode: [
    { name: "toggleVisibility", label: "Toggle Visibility", description: "Show or hide the visualizer" },
  ],
};

/**
 * Executes an action on a node by returning the patched data.
 */
export function executeNodeAction(
  nodeType: string,
  actionName: string,
  currentData: FlowNodeType["data"]
): Partial<FlowNodeType["data"]> | null {
  console.log(`[executeNodeAction] Running action "${actionName}" on node type "${nodeType}"`, currentData);

  switch (nodeType) {
    case "audioFlowNode": {
      switch (actionName) {
        case "togglePlay":
          return { isPlaying: !currentData.isPlaying };
        case "play":
          return { isPlaying: true };
        case "pause":
          return { isPlaying: false };
        case "stop":
          return { isPlaying: false }; // Handled in node code to reset time too
        case "toggleMute":
          return { isMuted: !currentData.isMuted };
        case "volumeUp": {
          const currentVol = currentData.volume !== undefined ? Number(currentData.volume) : 1.0;
          return { volume: Math.min(1.0, currentVol + 0.1) };
        }
        case "volumeDown": {
          const currentVol = currentData.volume !== undefined ? Number(currentData.volume) : 1.0;
          return { volume: Math.max(0.0, currentVol - 0.1) };
        }
        default:
          return null;
      }
    }

    case "captureSourceNode": {
      if (actionName === "toggleCapture") {
        return { isPlaying: !currentData.isPlaying }; // Or start/stop capture
      }
      if (actionName === "startCapture") return { isPlaying: true };
      if (actionName === "stopCapture") return { isPlaying: false };
      return null;
    }

    case "targetOutputNode": {
      switch (actionName) {
        case "togglePreview":
          return { isPreviewActive: !currentData.isPreviewActive };
        case "toggleRecording":
          return { isRecording: !currentData.isRecording };
        case "toggleStreaming":
          return { isStreaming: !currentData.isStreaming };
        default:
          return null;
      }
    }

    case "textOverlayNode":
    case "colorOverlayNode":
    case "imageOverlayNode":
    case "visualizerOverlayNode": {
      if (actionName === "toggleVisibility") {
        const currentOpacity = currentData.opacity !== undefined ? Number(currentData.opacity) : 1.0;
        return { opacity: currentOpacity > 0 ? 0.0 : 1.0 };
      }
      return null;
    }

    default:
      return null;
  }
}
