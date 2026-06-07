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
import { type Edge, type Viewport } from "@xyflow/react";
import { FlowNodeType } from "@/types/flow-node";

type FlowStoreContextValue = {
  getFlowNode(id: string): FlowNodeType;
  setFlowNode(id: string): void;
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
};

const FlowStoreContext = createContext<FlowStoreContextValue | undefined>(
  undefined,
);

export const FlowStoreProvider: React.FC<React.PropsWithChildren> = async (
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

  // const getFlowNode = (id: string) => {
  //   const [getNode, _] = useAtom(flowNodeAtomFamily(id));

  //   return getNode;
  // };

  // const setFlowNode = (id: string) => {
  //   const [_, setNode] = useAtom(flowNodeAtomFamily(id));

  //   return setNode;
  // };

  useEffect(() => {
    const loadData = async () => {
      if (!loaded) {
        try {
          const receivedData = await window["electron"].loadData().then(() => {
            setLoaded(true);
          });
          const newFlowData = JSON.parse(receivedData);
          setFlowData(newFlowData);
          console.log("New data set in FlowData");
        } catch (error) {
          console.error(error);
          setFlowData(defaultFlowData);
          console.log("FlowData set to Default Flow Data");
        }
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

  useEffect(() => {
    console.log(
      "[FlowStoreProvider] hasUnsavedChanges changed to",
      hasUnsavedChanges,
    );
  }, [hasUnsavedChanges]);

  return (
    <FlowStoreContext.Provider
      value={{
        getFlowNode,
        setFlowNode,
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
      }}
    >
      {props.children}
    </FlowStoreContext.Provider>
  );
};

export function useFlowStore() {
  const ctx = useContext(FlowStoreContext);
  if (!ctx)
    throw new Error("useFlowStore must be used inside FlowStoreProvider");
  return ctx;
}
