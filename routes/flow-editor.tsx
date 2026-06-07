import {
  addEdge,
  Controls,
  FitViewOptions,
  MiniMap,
  ReactFlow,
  useNodesState,
  useEdgesState,
  EdgeTypes,
  SimpleBezierEdge,
} from "@xyflow/react";
import { useCallback, useEffect, useState } from "react";
import { AudioNode } from "@/components/audio-node";
import { createFileRoute } from "@tanstack/react-router";
import { AnimatedRoute } from "@/components/animated-route";
import { LoadingAnimation } from "@/components/animations/loading-animation";
import { motion } from "motion/react";
import NodeActionBar from "@/components/node-action-bar";
import ConnectionLine from "@/components/ConnectionLine";
import { DevTools } from "@/components/devtools";
import { useStateMachine } from "@/store/stateMachine";
import { FlowNodeType } from "@/types/flow-node";
import "@xyflow/react/dist/style.css";
import { SonicBackground } from "@/components/sonicbackground";

const nodeTypes = {
  audioFlowNode: AudioNode,
};

const edgeTypes: EdgeTypes = {
  default: SimpleBezierEdge,
  // default: BezierEdge,
  // straight: StraightEdge,
  // step: StepEdge,
  // smoothstep: SmoothStepEdge,
  // simplebezier: SimpleBezier
};

const fitViewOptions: FitViewOptions = {
  padding: "100px",
};

export const Route = createFileRoute("/flow-editor")({
  beforeLoad: ({ context }) => {
    console.log("FlowEditor page");
    console.log("Current theme in loader:", context.appTheme);
  },
  component: FlowEditor,
  pendingComponent: LoadingAnimation,
});

function FlowEditor() {
  const {
    flowNodesData,
    flowEdgesData,
    flowViewportData,
    setHasUnsavedChanges,
  } = useStateMachine();

  const [selectedNodes, setSelectedNodes] = useState([] as FlowNodeType[]);
  const [currentNodes, setCurrentNodes, onNodesChange] =
    useNodesState(flowNodesData);
  const [currentEdges, setCurrentEdges, onEdgesChange] =
    useEdgesState(flowEdgesData);
  const [currentViewport, setCurrentViewport] = useState(flowViewportData);

  const onConnect = useCallback(
    (connection) => {
      setCurrentEdges((current) => {
        const nextEdges = addEdge(connection, current);
        console.log("[Edge] Updated Edges:", nextEdges);
        return nextEdges;
      });
    },
    [setCurrentEdges],
  );

  const handleSelectionChange = (elements) => {
    if (selectedNodes != elements.nodes) {
      setSelectedNodes(elements.nodes);
      console.log("[Selection] [Node] Selected:", selectedNodes);
    }
  };

  const handleEdgesChange = useCallback(
    (changedEdges) => {
      onEdgesChange(changedEdges);
      // console.log("[Edge] Changes:", changedEdges);
      // setCurrentEdges(applyEdgeChanges(changedEdges, currentEdges));
      console.log("[Edge] Updated Edges:", currentEdges);
    },
    [setCurrentEdges],
  );

  const handleNodesChange = useCallback(
    (changedNodes) => {
      onNodesChange(changedNodes);
      console.log("[Node] Changes:", changedNodes);
      // setCurrentNodes(applyNodeChanges(changedNodes, currentNodes));
      // setFlowNodesData(currentNodes);
      console.log("[Node] Updated Nodes:", currentNodes);
    },
    [setCurrentNodes],
  );

  const handleConnect = useCallback(
    (connection) => {
      console.log("[Connection] Changes:", connection);
      onConnect(connection);
    },
    [onConnect],
  );

  useEffect(() => {
    //
    return () => {
      if (currentNodes != flowNodesData || currentEdges != flowEdgesData) {
        setHasUnsavedChanges(true);
      } else {
        setHasUnsavedChanges(false);
      }
    };
    //
  }, [currentNodes, currentEdges]);

  return (
    <AnimatedRoute variant="fade">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
      >
        <div
          style={{
            width: "100vw",
            marginTop: "0px",
            height: "calc(100vh - 61px)",
          }}
        >
          <ReactFlow
            id="reactFlowProvider"
            nodes={currentNodes}
            nodeTypes={nodeTypes}
            edges={currentEdges}
            edgeTypes={edgeTypes}
            minZoom={0.65}
            maxZoom={1}
            fitView
            fitViewOptions={fitViewOptions}
            connectionLineComponent={ConnectionLine}
            proOptions={{
              hideAttribution: true,
            }}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onSelectionChange={handleSelectionChange}
            viewport={currentViewport}
            onViewportChange={setCurrentViewport}
          >
            <div className="flex w-[130]">
              <NodeActionBar nodes={selectedNodes} />
            </div>
            {/* <DevTools position="top-left" /> */}
            <Controls position="bottom-left" />
            <MiniMap position="bottom-left" className="left-10!" />
            <SonicBackground />
            {/* <DevTools aria-data-type="devtools" position="top-left" /> */}
          </ReactFlow>
        </div>
      </motion.div>
    </AnimatedRoute>
  );
}
