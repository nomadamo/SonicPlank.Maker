//
import { atom } from "jotai";
import { atomFamily } from "jotai-family";
import { Viewport, type Edge } from "@xyflow/react";
import { FlowNodeType } from "@/types/flow-node";

export type FlowData = {
  nodes: FlowNodeType[];
  edges: Edge[];
  viewport: Viewport;
};

export const defaultFlowData: FlowData = {
  nodes: [],
  edges: [],
  viewport: { x: 100, y: 100, zoom: 1 },
};

function isOnlySelectionChange(oldNodes: FlowNodeType[], newNodes: FlowNodeType[], oldEdges: Edge[], newEdges: Edge[]): boolean {
  if (oldNodes.length !== newNodes.length || oldEdges.length !== newEdges.length) return false;
  
  for (let i = 0; i < oldEdges.length; i++) {
    if (oldEdges[i].id !== newEdges[i].id) return false;
    if (oldEdges[i].source !== newEdges[i].source || oldEdges[i].target !== newEdges[i].target) return false;
  }
  
  for (let i = 0; i < oldNodes.length; i++) {
    if (oldNodes[i].id !== newNodes[i].id) return false;
    if (oldNodes[i].position.x !== newNodes[i].position.x || oldNodes[i].position.y !== newNodes[i].position.y) return false;
    if (oldNodes[i].type !== newNodes[i].type) return false;
    if (oldNodes[i].data !== newNodes[i].data) return false;
  }
  
  return true;
}

type FlowCoreData = Omit<FlowData, "viewport">;

interface FlowHistory {
  past: FlowCoreData[];
  present: FlowCoreData;
  future: FlowCoreData[];
}

const flowViewportInternalAtom = atom<Viewport>(defaultFlowData.viewport);

const flowHistoryAtom = atom<FlowHistory>({
  past: [],
  present: { nodes: defaultFlowData.nodes, edges: defaultFlowData.edges },
  future: [],
});

export const flowDataAtom = atom(
  (get) => {
    const history = get(flowHistoryAtom);
    const viewport = get(flowViewportInternalAtom);
    return { ...history.present, viewport } as FlowData;
  },
  (get, set, update: FlowData | ((prev: FlowData) => FlowData)) => {
    const currentState = get(flowDataAtom);
    const nextState = typeof update === "function" ? update(currentState) : update;
    const history = get(flowHistoryAtom);

    // Always update viewport separately
    set(flowViewportInternalAtom, nextState.viewport);

    // If core nodes/edges haven't changed, don't push to history
    if (history.present.nodes === nextState.nodes && history.present.edges === nextState.edges) {
      return;
    }

    const isSelectionOnly = isOnlySelectionChange(history.present.nodes, nextState.nodes, history.present.edges, nextState.edges);

    set(flowHistoryAtom, {
      past: isSelectionOnly ? history.past : [...history.past, history.present].slice(-50),
      present: { nodes: nextState.nodes, edges: nextState.edges },
      future: [],
    });
  }
);

export const loadFlowDataAtom = atom(
  null,
  (_get, set, newData: FlowData) => {
    set(flowViewportInternalAtom, newData.viewport);
    set(flowHistoryAtom, {
      past: [],
      present: { nodes: newData.nodes, edges: newData.edges },
      future: [],
    });
  }
);

export const undoFlowAtom = atom(null, (get, set) => {
  const history = get(flowHistoryAtom);
  if (history.past.length === 0) return;

  const previous = history.past[history.past.length - 1];
  const newPast = history.past.slice(0, -1);

  set(flowHistoryAtom, {
    past: newPast,
    present: previous,
    future: [history.present, ...history.future],
  });
});

export const redoFlowAtom = atom(null, (get, set) => {
  const history = get(flowHistoryAtom);
  if (history.future.length === 0) return;

  const next = history.future[0];
  const newFuture = history.future.slice(1);

  set(flowHistoryAtom, {
    past: [...history.past, history.present],
    present: next,
    future: newFuture,
  });
});

export const canUndoFlowAtom = atom((get) => get(flowHistoryAtom).past.length > 0);
export const canRedoFlowAtom = atom((get) => get(flowHistoryAtom).future.length > 0);
export const flowCurrentPathAtom = atom<string | null>(null);
export const flowHasUnsavedChangesAtom = atom<boolean>(false);

// Global streaming state — set by target-output-node when stream starts/stops.
// Other nodes (e.g. TwitchChatNode) can watch this to auto-connect.
export const isStreamingAtom = atom<boolean>(false);

export type VodPlatform = "twitch" | "youtube" | "custom";

export type VodStatus = {
  platform: VodPlatform;
  filePath: string;
} & (
  | { phase: "recording_saved" }
  | { phase: "searching" }
  | { phase: "uploading"; progress: number }
  | { phase: "found"; vodUrl: string }
  | { phase: "not_found" }
  | { phase: "error"; message: string }
);

export const vodStatusAtom = atom<VodStatus | null>(null);

// ── Stream Deck API command atom ─────────────────────────────────────────────
// Set by ApiBridge when an external API command arrives (e.g. from Stream Deck).
// Each command carries a unique id so repeated same-action commands still fire effects.
export interface ApiCommand {
  action: string;
  id: number;
  payload: Record<string, unknown>;
}
export const apiCommandAtom = atom<ApiCommand | null>(null);

export const flowNodeAtomFamily = atomFamily((id) =>
  atom(
    (get) => {
      const currentNodes = get(flowDataAtom).nodes;
      const node: FlowNodeType =
        currentNodes.find((node) => node.id === id) || ({} as FlowNodeType);
      return node;
    },
    (get, set, updatedNode: FlowNodeType) => {
      const currentState = get(flowDataAtom);
      set(flowDataAtom, {
        ...currentState,
        nodes: currentState.nodes.map((n) =>
          n.id === (updatedNode as FlowNodeType).id ? updatedNode : n,
        ),
      });
    },
  ),
);

export const flowEdgeAtomFamily = atomFamily((id) =>
  atom(
    (get) => {
      const currentEdges = get(flowDataAtom).edges;
      const edge: Edge =
        currentEdges.find((edge) => edge.id === id) || ({} as Edge);
      return edge;
    },
    (get, set, updatedEdge) => {
      const currentEdges = get(flowDataAtom).edges;
      set(flowDataAtom, (prevState) => ({
        ...prevState,
        edges: { ...currentEdges, update: updatedEdge },
      }));
    },
  ),
);

// export const [flowEdgeAtom, setFlowEdgeAtom] = atom(
//   (get, id: string) => get(flowDataAtom).nodes.map((node) => node.id == id),
//   (set, id: string) => set(flowDataAtom).edges.map((edge) => edge.id == id),
//   (update: Edge | ((prev: Edge) => Edge)) => {
//     const prevEdge = get(flowDataAtom).edges.map((edge) => edge.id == edgeid);
//     const nextEdge = typeof update === "function" ? update(prevEdge) : update;
//     set(flowDataAtom, { ...prevEdge, ...nextEdge });
//   },
// );

export const flowNodesAtom = atom(
  (get) => get(flowDataAtom).nodes,
  (
    get,
    set,
    update: FlowNodeType[] | ((prev: FlowNodeType[]) => FlowNodeType[]),
  ) => {
    const currentState = get(flowDataAtom);
    const nextNodes =
      typeof update === "function" ? update(currentState.nodes) : update;
    set(flowDataAtom, { ...currentState, nodes: nextNodes });
  },
);

export const flowViewportAtom = atom(
  (get) => get(flowDataAtom).viewport,
  (get, set, update: Viewport | ((prev: Viewport) => Viewport)) => {
    const currentState = get(flowDataAtom);
    const nextViewport =
      typeof update === "function" ? update(currentState.viewport) : update;
    set(flowDataAtom, { ...currentState, viewport: nextViewport });
  },
);

// 3. Custom atom to update edges specifically
export const flowEdgesAtom = atom(
  (get) => get(flowDataAtom).edges,
  (get, set, update: Edge[] | ((prev: Edge[]) => Edge[])) => {
    const currentState = get(flowDataAtom);
    const nextEdges =
      typeof update === "function" ? update(currentState.edges) : update;
    set(flowDataAtom, { ...currentState, edges: nextEdges });
  },
);

// Helper write-only atom: update a single node's data by id.
// markUnsaved (default true) controls whether this write flags the flow as having unsaved changes.
// Pass markUnsaved: false for runtime/init updates (theme loading, scene switches, stream-start resets)
// that should not prompt the user to save.
export const updateNodeDataAtom = atom(
  null,
  (
    get,
    set,
    { id, patch, markUnsaved = true }: { id: string; patch: Partial<FlowNodeType["data"]>; markUnsaved?: boolean },
  ) => {
    const currentState = get(flowDataAtom);
    if (!currentState.nodes.some((n) => n.id === id)) return;
    set(flowDataAtom, {
      ...currentState,
      nodes: currentState.nodes.map((n) =>
        n.id === id ? { ...n, data: { ...n.data, ...patch } } : n,
      ),
    });
    if (markUnsaved) set(flowHasUnsavedChangesAtom, true);
  },
);

if (process.env.NODE_ENV !== "production") {
  flowDataAtom.debugLabel = "flowData";
}
