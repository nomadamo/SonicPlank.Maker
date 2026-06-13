import { atom, useAtom } from "jotai";
import { atomFamily } from "jotai-family";
import { flowDataAtom } from "./flowStore";
import { executeNodeAction } from "@/utils/node-actions";

export type TransientNodeState = Record<string, any>;

export const DEFAULT_TRANSIENT_STATES: Record<string, TransientNodeState> = {
  audioFlowNode: {
    isPlaying: false,
  },
  captureSourceNode: {
    isPlaying: false,
  },
  targetOutputNode: {
    isPreviewActive: false,
    isRecording: false,
    isStreaming: false,
  },
};

// Map nodeId -> transient state atom
export const transientNodeStateFamily = atomFamily((nodeId: string) =>
  atom<TransientNodeState>({})
);

// Write-only action runner atom
export const triggerNodeActionAtom = atom(
  null,
  (get, set, { nodeId, nodeType, actionName }: { nodeId: string; nodeType: string; actionName: string }) => {
    // 1. Get persistent node data
    const flowData = get(flowDataAtom);
    const node = flowData.nodes.find((n) => n.id === nodeId);
    const nodeData = node ? node.data : {};

    // 2. Get current transient state
    const transientState = get(transientNodeStateFamily(nodeId));
    const defaults = DEFAULT_TRANSIENT_STATES[nodeType] || {};

    // 3. Merge default, persistent and transient states to match what executeNodeAction expects
    const mergedData = {
      ...defaults,
      ...nodeData,
      ...transientState,
    };

    // 4. Execute the action
    const patch = executeNodeAction(nodeType, actionName, mergedData);
    if (!patch) return null;

    // 5. Partition patch into transient vs persistent updates
    const transientKeys = Object.keys(defaults);
    const persistentPatch: Record<string, any> = {};
    const transientPatch: Record<string, any> = {};

    Object.entries(patch).forEach(([key, val]) => {
      if (transientKeys.includes(key)) {
        transientPatch[key] = val;
      } else {
        persistentPatch[key] = val;
      }
    });

    // 6. Write transient patch
    if (Object.keys(transientPatch).length > 0) {
      set(transientNodeStateFamily(nodeId), (prev) => ({
        ...prev,
        ...transientPatch,
      }));
    }

    // 7. Write persistent patch to flowDataAtom (keeping React Flow nodes in sync)
    if (Object.keys(persistentPatch).length > 0) {
      set(flowDataAtom, (prev) => ({
        ...prev,
        nodes: prev.nodes.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, ...persistentPatch } } : n
        ),
      }));
    }

    return {
      persistentPatch,
      transientPatch,
      patch,
    };
  }
);

export function useTransientNodeState(nodeId: string, nodeType?: string) {
  const [state, setState] = useAtom(transientNodeStateFamily(nodeId));

  const defaults = nodeType ? DEFAULT_TRANSIENT_STATES[nodeType] || {} : {};

  const getVal = <T = any>(key: string, fallback?: T): T => {
    if (state[key] !== undefined) return state[key] as T;
    if (defaults[key] !== undefined) return defaults[key] as T;
    return fallback as T;
  };

  const setVal = (key: string, value: any) => {
    setState((prev) => ({
      ...prev,
      [key]: typeof value === "function" ? value(prev[key]) : value,
    }));
  };

  const updateState = (patch: Record<string, any>) => {
    setState((prev) => ({ ...prev, ...patch }));
  };

  return {
    state,
    getVal,
    setVal,
    updateState,
  };
}
