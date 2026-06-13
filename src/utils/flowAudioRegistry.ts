import { $webAudio } from "@/lib/web-audio";

export interface FlowAudioItem {
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gainNode: GainNode;
  analyserNode: AnalyserNode;
}

const flowRegistry = new Map<string, FlowAudioItem>();

export function getOrCreateFlowAudio(
  nodeId: string,
  mediaPath: string,
): FlowAudioItem | null {
  if (!mediaPath) return null;

  let item = flowRegistry.get(nodeId);
  const cleanPath =
    mediaPath.startsWith("http") || mediaPath.startsWith("file://")
      ? mediaPath
      : "file:///" + mediaPath.replace(/\\/g, "/");

  if (item) {
    if (item.audio.src !== cleanPath) {
      console.log(
        `[flowAudioRegistry] Updating src for nodeId ${nodeId} to: ${cleanPath}`,
      );
      const wasPlaying = !item.audio.paused;
      item.audio.src = cleanPath;
      if (wasPlaying) {
        item.audio
          .play()
          .catch((e) =>
            console.error("[flowAudioRegistry] Auto-resume play failed:", e),
          );
      }
    }
    return item;
  }

  const ctx = $webAudio.getContext();
  if (!ctx) {
    console.warn("[flowAudioRegistry] WebAudio context is not available yet.");
    return null;
  }

  try {
    console.log(
      `[flowAudioRegistry] Creating new audio instance for node ${nodeId} with src: ${cleanPath}`,
    );
    const audio = new Audio(cleanPath);
    audio.crossOrigin = "anonymous";
    audio.loop = true; // Loop audio nodes by default in flow editor!

    const source = ctx.createMediaElementSource(audio);
    const gainNode = ctx.createGain();
    const analyserNode = ctx.createAnalyser();

    analyserNode.fftSize = 256;
    analyserNode.smoothingTimeConstant = 0.6;

    // Connect: source -> gainNode -> analyser -> destination
    source.connect(gainNode);
    gainNode.connect(analyserNode);
    analyserNode.connect(ctx.destination);

    item = { audio, source, gainNode, analyserNode };
    flowRegistry.set(nodeId, item);
    return item;
  } catch (err) {
    console.error(
      `[flowAudioRegistry] Error initializing flow audio nodes for nodeId ${nodeId}:`,
      err,
    );
    return null;
  }
}

export function getFlowAudioAnalyser(nodeId: string): AnalyserNode | null {
  return flowRegistry.get(nodeId)?.analyserNode || null;
}

export function removeFlowAudio(nodeId: string) {
  const item = flowRegistry.get(nodeId);
  if (item) {
    console.log(
      `[flowAudioRegistry] Releasing audio resources for node: ${nodeId}`,
    );
    try {
      item.audio.pause();
      item.audio.src = "";
      item.source.disconnect();
      item.gainNode.disconnect();
      item.analyserNode.disconnect();
    } catch (e) {
      // Ignore disconnect errors
    }
    flowRegistry.delete(nodeId);
  }
}

export function clearAllFlowAudio() {
  console.log("[flowAudioRegistry] Clearing all flow audio nodes.");
  for (const nodeId of flowRegistry.keys()) {
    removeFlowAudio(nodeId);
  }
}
