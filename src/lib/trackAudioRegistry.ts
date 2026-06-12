import { $webAudio } from "@/lib/web-audio";

export interface TrackAudioNodes {
  gainNode: GainNode;
  pannerNode: StereoPannerNode;
  analyserNode: AnalyserNode;
}

const registry = new Map<string, TrackAudioNodes>();

export function getOrCreateTrackNodes(trackId: string): TrackAudioNodes | null {
  const ctx = $webAudio.getContext();
  if (!ctx) return null;

  let nodes = registry.get(trackId);
  if (!nodes) {
    try {
      const gainNode = ctx.createGain();
      const pannerNode = ctx.createStereoPanner();
      const analyserNode = ctx.createAnalyser();

      analyserNode.fftSize = 256;
      analyserNode.smoothingTimeConstant = 0.4;

      // Connect nodes: gain -> panner -> analyser -> destination
      gainNode.connect(pannerNode);
      pannerNode.connect(analyserNode);
      analyserNode.connect(ctx.destination);

      nodes = { gainNode, pannerNode, analyserNode };
      registry.set(trackId, nodes);
    } catch (err) {
      console.error("Error creating track audio nodes:", err);
      return null;
    }
  }
  return nodes;
}

export function removeTrackNodes(trackId: string) {
  const nodes = registry.get(trackId);
  if (nodes) {
    try {
      nodes.gainNode.disconnect();
      nodes.pannerNode.disconnect();
      nodes.analyserNode.disconnect();
    } catch (e) {
      // Ignore errors during disconnect
    }
    registry.delete(trackId);
  }
}

export function cleanupUnusedTrackNodes(currentTrackIds: Set<string>) {
  for (const trackId of registry.keys()) {
    if (!currentTrackIds.has(trackId)) {
      removeTrackNodes(trackId);
    }
  }
}

export function getTrackAnalyser(trackId: string): AnalyserNode | null {
  return registry.get(trackId)?.analyserNode || null;
}

export function clearAllTrackNodes() {
  for (const trackId of registry.keys()) {
    removeTrackNodes(trackId);
  }
}
