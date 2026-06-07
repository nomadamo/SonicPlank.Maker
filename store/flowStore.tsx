//
import { atom, useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { atomFamily } from "jotai-family";
import { atomWithQuery, queryClientAtom } from "jotai-tanstack-query";
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

export const flowStorageAtom = atomWithStorage<FlowData>(
  "flowData",
  defaultFlowData,
);

export const flowQueryAtom = atomWithQuery<FlowData>((get) => ({
  queryKey: ["flowData"],
  queryFn: async () => get(flowStorageAtom),
  staleTime: 1000 * 60 * 5,
  cacheTime: 1000 * 60 * 10,
}));

export const flowDataAtom = atom(
  (get) => {
    const query = get(flowQueryAtom);
    return query.data ?? get(flowStorageAtom);
  },
  (get, set, update: FlowData | ((prev: FlowData) => FlowData)) => {
    const prev = get(flowQueryAtom).data ?? get(flowStorageAtom);
    const newValue = typeof update === "function" ? update(prev) : update;
    set(flowStorageAtom, newValue);
    const queryClient = get(queryClientAtom);
    queryClient.setQueryData(["flowData"], newValue);
  },
);

export const flowNodeAtomFamily = atomFamily((id) =>
  atom(
    (get) => {
      const currentNodes = get(flowDataAtom).nodes;
      const node: FlowNodeType =
        currentNodes.find((node) => node.id === id) || ({} as FlowNodeType);
      return node;
    },
    (get, set, updatedNode) => {
      const currentNodes = get(flowDataAtom).nodes;
      set(flowDataAtom, (prevState) => ({
        ...prevState,
        nodes: { ...currentNodes, update: updatedNode },
      }));
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

export const flowViewportData = atom(
  (get) => get(flowDataAtom).viewport,
  (get, set, update: Viewport | ((prev: Viewport) => Viewport)) => {
    const currentState = get(flowDataAtom);
    const nextViewport =
      typeof update === "function" ? update(currentState.viewport) : update;
    set(flowDataAtom, { ...currentState, viewport: nextViewport });
  },
);

export const saveAllData = () => {
  window.electron.saveData(useAtom(flowDataAtom)[0]);
};

if (process.env.NODE_ENV !== "production") {
  flowStorageAtom.debugLabel = "flowStorage";
  flowQueryAtom.debugLabel = "flowQuery";
}
