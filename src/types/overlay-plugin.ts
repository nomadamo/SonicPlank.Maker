import type { ComponentStyleProps } from "./flow-node";

/**
 * Manifest for a plugin-provided overlay type.
 * Built-in types are pre-registered at startup; plugins register additional
 * entries via main-process IPC on installation.
 *
 * Wired when the plugin system is implemented (Phase 7).
 */
export interface OverlayTypeManifest {
  id: string;
  displayName: string;
  description?: string;
  componentType: string;
  defaultStyleProps: ComponentStyleProps;
  defaultSize: { width: number; height: number };
  iconPath?: string;
}
