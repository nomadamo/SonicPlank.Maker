import { createContext, useContext, useEffect, useState } from "react";
import { useAtom } from "jotai";
import {
  FlowData,
  flowDataAtom,
  flowNodesAtom,
  flowEdgesAtom,
  flowViewportAtom,
  defaultFlowData,
  flowNodeAtomFamily,
} from "./flowStore";
import { useTheme, type Theme } from "./themeprovider";
import { ReactFlowProvider, type Edge, type Viewport } from "@xyflow/react";
import { FlowNodeType } from "@/types/flow-node";
import WaveSurfer, { WaveSurferOptions } from "wavesurfer.js";
import { WaveSurferProvider, useWaveSurferContext } from "./wavesurferprovider";

type StateMachineContextValue = {
  // getFlowNode(id: string): FlowNodeType;
  // setFlowNode(id: string): void;
  flowData: FlowData;
  setFlowData: (next: FlowData | ((prev: FlowData) => FlowData)) => void;
  flowNodesData: FlowNodeType[];
  setFlowNodesData: (
    next: FlowNodeType[] | ((prev: FlowNodeType[]) => FlowNodeType[]),
  ) => void;
  flowEdgesData: Edge[];
  setFlowEdgesData: (next: Edge[] | ((prev: Edge[]) => Edge[])) => void;
  flowViewportData: Viewport;
  setFlowViewportData: (
    next: Viewport | ((prev: Viewport) => Viewport),
  ) => void;
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges(value: boolean): void;
  quitRequested: boolean;
  setQuitRequested(value: boolean): void;
  theme: Theme;
  setTheme: (theme: Theme) => void;
  initInstance: (
    id: string,
    container: HTMLDivElement | null,
    options: WaveSurferOptions,
  ) => WaveSurfer;
  getInstance: (id: string) => WaveSurfer | undefined;
  destroyInstance: (id: string) => void;
};

const StateMachineContext = createContext<StateMachineContextValue | undefined>(
  undefined,
);

export const StateMachineProvider: React.FC<React.PropsWithChildren> = async (
  props,
) => {
  const [flowData, setFlowData] = useAtom(flowDataAtom);
  const [flowNodesData, setFlowNodesData] = useAtom(flowNodesAtom);
  const [flowEdgesData, setFlowEdgesData] = useAtom(flowEdgesAtom);
  const [flowViewportData, setFlowViewportData] = useAtom(flowViewportAtom);
  const [mounted, setMounted] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [quitRequested, setQuitRequested] = useState(false);
  const { theme, setTheme } = useTheme();
  const { initInstance, getInstance, destroyInstance } = useWaveSurferContext();

  useEffect(() => {
    console.log(
      "[StateMachineProvider] hasUnsavedChanges changed to",
      hasUnsavedChanges,
    );
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const receivedData = await window["electron"].loadData();
        const newFlowData = JSON.parse(receivedData);
        setFlowData(newFlowData);
        setLoaded(true);
        console.log("New data set in FlowData");
      } catch (error) {
        console.error(error);
        setFlowData(defaultFlowData);
        console.log("FlowData set to Default Flow Data");
      }
    };
    if (!loaded && mounted) {
      loadData();
    }
    // .then((receivedData) => {
    //   if (!mounted || !receivedData) return;
    //   const newFlowData = JSON.parse(receivedData);
    //   setFlowData(newFlowData);
    // })
    // .catch((error) => {
    //   console.error(error);
    //   incrementRetries(retries + 1);
    // });
    return () => {
      setMounted(false);
    };
  }, [flowData]);

  // const getFlowNode = (id: string) => {
  //   const [getNode, _] = useAtom(flowNodeAtomFamily(id));

  //   return getNode;
  // };

  // const setFlowNode = (id: string) => {
  //   const [_, setNode] = useAtom(flowNodeAtomFamily(id));

  //   return setNode;
  // };

  return (
    <ReactFlowProvider>
      <StateMachineContext.Provider
        value={{
          // getFlowNode,
          // setFlowNode,
          flowData,
          setFlowData,
          flowNodesData,
          setFlowNodesData,
          flowEdgesData,
          setFlowEdgesData,
          flowViewportData,
          setFlowViewportData,
          hasUnsavedChanges,
          setHasUnsavedChanges,
          quitRequested,
          setQuitRequested,
          theme,
          setTheme,
          initInstance,
          getInstance,
          destroyInstance,
        }}
      >
        {props.children}
      </StateMachineContext.Provider>
    </ReactFlowProvider>
  );
};

export function useStateMachine() {
  const ctx = useContext(StateMachineContext);
  if (!ctx)
    throw new Error("useStateMachine must be used inside StateMachineProvider");
  return ctx;
}
