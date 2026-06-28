import type { FlowNodeType, OverlayThemeLayout } from "@/types/flow-node";

/**
 * Returns the position/size defined for a component type in any active overlayThemeNode.
 * Returns null when no theme is loaded or no matching component exists.
 */
export function getThemeDefaultForType(
  componentType: string,
  nodes: FlowNodeType[],
): { x: number; y: number; width: number; height: number } | null {
  for (const node of nodes) {
    if (node.type !== "overlayThemeNode") continue;
    const layout = node.data.themeLayout as OverlayThemeLayout | null | undefined;
    const baseScene = layout?.scenes?.[0];
    if (!baseScene?.components?.length) continue;
    const comp = baseScene.components.find((c) => c.componentType === componentType);
    if (comp) return { x: comp.x, y: comp.y, width: comp.width, height: comp.height };
  }
  return null;
}
