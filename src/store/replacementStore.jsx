import { addEdge, applyNodeChanges, applyEdgeChanges } from "@xyflow/react";
import { create } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { nanoid } from "nanoid";

const createSelectors = (_store) => {
  const store = _store;
  store.use = {};
  for (const k of Object.keys(store.getState())) {
    store.use[k] = () => useStoreWithEqualityFn(_store, (s) => s[k]);
  }

  return store;
};

function isSuccess(handle) {
  return handle.label === "On Success";
}
function isFailure(handle) {
  return handle.label === "On Failure";
}
function isTarget(id, edge) {
  return edge.sourceHandle === id;
}

const flowStore = create((set, get) => ({
  nodes: [],

  edges: [],

  viewport: { x: 76, y: 83, zoom: 1 },

  nodeById(nodeId) {
    return get().nodes.filter((node) => node.id === nodeId);
  },

  addConnection(source, target, sourceHandle, targetHandle) {
    const connection = { source, target, sourceHandle, targetHandle };
    console.log("🚀 ~ addConnection ~ connection:", connection);
    set((state) => ({
      edges: addEdge(
        { source, target, sourceHandle, targetHandle },
        state.edges,
      ),
    }));
  },

  applyConfig(nodeId, command, configValues) {
    let targetNode = get().nodeById(nodeId);
    if (targetNode) {
      let existingConfig = targetNode.data.config;
      if (existingConfig && existingConfig.length > 0) {
        set((state) => ({
          ...state.nodes
            .filter((node) => node.id === nodeId)
            .data.config.map((cfg) =>
              cfg.command === command
                ? {
                    ...cfg,
                    config: { ...configValues },
                  }
                : cfg,
            ),
        }));
      } else {
        set((state) => ({
          ...state.nodes.filter((node) => node.id === nodeId).data,
          config: [],
        }));
      }
    }
  },

  getNodes() {
    return get().nodes;
  },

  getEdges() {
    return get().edges;
  },

  initNew() {
    set({
      nodes: [
        {
          type: "Action",
          id: nanoid(6),
          disableContext: "",
          data: {
            command: "",
            summary: "Not configured",
            helpMessage: "",
            config: [],
            minimized: true,
            handles: [
              {
                id: nanoid(6),
                hidden: true,
                type: "target",
                label: "Criteria",
                position: "left",
              },
              {
                id: nanoid(6),
                hidden: false,
                type: "source",
                kind: "success",
                label: "On Success",
                position: "right",
                style: {
                  positionAnchor: "--successAnchor",
                  right: "calc(-10px + anchor(right))",
                  top: "calc(10px + anchor(top))",
                },
              },
              {
                id: nanoid(6),
                hidden: false,
                type: "source",
                kind: "failure",
                label: "On Failure",
                position: "right",
                style: {
                  positionAnchor: "--failureAnchor",
                  right: "calc(-10px + anchor(right))",
                  top: "calc(10px + anchor(top))",
                },
              },
            ],
            notes: [
              {
                author: "ARDENTHEALTH\\dbatey-SbPAM",
                private: false,
                date: "11-17-2024 @ 3:39pm",
                text: "This is a test note.\r\n",
              },
            ],
          },
          deletable: false,
          position: { x: 0, y: 0 },
        },
      ],
      edges: [],
      viewport: { x: 76, y: 83, zoom: 1 },
    });
  },

  onViewPortChange(vpchanges) {
    set({ viewport: vpchanges });
  },

  onNodesChange(changes) {
    // console.log("onNodesChange Called");
    // console.log(changes);
    set((state) => ({ nodes: applyNodeChanges(changes, state.nodes) }));
  },

  onEdgesChange(changes) {
    // console.log("onEdgesChange Called");
    // console.log(changes);
    set((state) => ({ edges: applyEdgeChanges(changes, state.edges) }));
  },

  onConnect(connection) {
    // console.log("onConnect Called");
    // console.log(data);
    set((state) => ({
      edges: addEdge({ ...connection }, state.edges),
    }));
  },

  setNodes(nodes) {
    set({ nodes });
  },

  setEdges(edges) {
    set({ edges });
  },

  addNote(id, note) {
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: { ...node.data, notes: [...node.data.notes, note] },
            }
          : node,
      ),
    }));
  },

  updateNodeHandle(id, handleId, handleSetting) {
    // console.log("updateNode Called for node with Id:" + id);
    // console.log(data);
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id
          ? {
              ...node,
              data: {
                ...node.data,
                handles: {
                  ...node.data.handles,
                  ...node.data.handles.map((handle) =>
                    handle.id === handleId
                      ? { ...handle, handleSetting }
                      : handle,
                  ),
                },
              },
            }
          : state.nodes,
      ),
    }));
  },
  updateNodeData(id, data) {
    // console.log("updateNode Called for node with Id:" + id);
    // console.log(data);
    set((state) => ({
      nodes: state.nodes.map((node) =>
        node.id === id ? { ...node, data: { ...node.data, ...data } } : node,
      ),
    }));
  },

  deleteNode(id) {
    // console.log(id);
    set((state) => ({ nodes: state.nodes.filter((node) => node.id != id) }));
    set((state) => ({
      edges: state.edges.filter(
        (edge) => edge.source != id && edge.target != id,
      ),
    }));
  },

  onDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  },

  addNodes(node) {
    set((state) => ({
      nodes: [...state.nodes, node],
    }));
  },

  onDrop(event, position) {
    event.preventDefault();
    var droppedData = event.dataTransfer.getData(
      "application/automation/reactflow/nodeData",
    );
    console.log("on Drop");
    console.log(droppedData);
    const nodeData = JSON.parse(droppedData);
    const newNode = {
      id: nanoid(6),
      type: nodeData.type,
      position: position,
      data: nodeData.data,
    };
    set((state) => ({
      nodes: [...state.nodes, newNode],
    }));
  },

  exportData() {
    const rfInstance = {
      nodes: [...get().nodes],
      edges: [...get().edges],
      viewport: get().viewport,
    };
    if (rfInstance) {
      return rfInstance;
    }
  },

  importData(jsonData) {
    if (jsonData != null) {
      var flowData = JSON.parse(jsonData);
      if (flowData != null) {
        set({ viewport: flowData.viewport || { x: 49, y: 36, zoom: 1 } });
        set({ nodes: flowData.nodes || [] });
        set({ edges: flowData.edges || [] });
      }
    }
  },

  saveFlow() {
    let nds = Object.entries(get().nodes);
    let edgs = Object.entries(get().edges);
    let wrkFlw = [];
    var successTargetId = null;
    var failTargetId = null;
    for (let [, nd] of nds) {
      if (nd.type === "Finish") {
        let data = nd.data;
        wrkFlw.push({ id: nd.id, type: nd.type, text: data.type });
      } else {
        let data = nd.data;
        let hndls = data.handles;
        let successHandle = hndls.find(isSuccess);
        if (successHandle) {
          let successHandleId = successHandle.id;
          let [, successTarget] = edgs.find(([, edge]) => {
            if (isTarget(successHandleId, edge)) {
              return edge;
            }
          });
          successTargetId = successTarget?.target ?? null;
        }
        let failHandle = hndls.find(isFailure);
        if (failHandle) {
          let failHandleId = failHandle.id;
          let [, failTarget] = edgs.find(([, edge]) => {
            if (isTarget(failHandleId, edge)) {
              return edge;
            }
          });
          failTargetId = failTarget?.target ?? null;
        }
        wrkFlw.push({
          id: nd.id,
          type: data.command,
          text: data.summary,
          config: [], // TODO: This needs to be updated to match updated node structure containing config
          pass: successTargetId,
          fail: failTargetId,
        });
      }
    }
    // console.log(wrkFlw);
    return wrkFlw;
  },
}));

const useFlowStore = createSelectors(flowStore);

export default useFlowStore;
