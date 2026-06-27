/**
 * Maps flow node type strings to OverlayElement type strings.
 * Single source of truth used by both target-output-node and overlay-theme-node.
 */
export function nodeTypeToOverlayType(nodeType: string): string {
  if (nodeType === "nowPlayingNode") return "nowPlaying";
  if (nodeType === "twitchChatNode") return "twitchChat";
  return nodeType.replace("OverlayNode", "");
}
