import { createContext, useContext, useEffect, useState } from "react";
import { useSetAtom } from "jotai";
import { flowDataAtom, defaultFlowData } from "./flowStore";
import { timelineDataAtom, defaultTimelineData } from "./timelineStore";
import { ReactFlowProvider } from "@xyflow/react";
import { useLibraryStore } from "./libraryStore";
import { useSettings } from "./settingsStore";
import { SplashOverlay } from "@/components/splash-overlay";
import "@arkn/react-icon-picker/dist/style.css";

type StateMachineContextValue = {
  loaded: boolean;
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges(value: boolean): void;
  quitRequested: boolean;
  setQuitRequested(value: boolean): void;
  persistRequested: boolean;
  setPersistRequested(value: boolean): void;
  theme: "light" | "dark" | "system";
  setTheme(value: "light" | "dark" | "system"): void;
};

const StateMachineContext = createContext<StateMachineContextValue | undefined>(
  undefined,
);

export const StateMachineProvider: React.FC<React.PropsWithChildren> = (
  props,
) => {
  const setFlowData = useSetAtom(flowDataAtom);
  const setTimelineData = useSetAtom(timelineDataAtom);
  const [loaded, setLoaded] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [quitRequested, setQuitRequested] = useState(false);
  const [persistRequested, setPersistRequested] = useState(false);
  const { settings, updateSettings } = useSettings();
  const theme = settings.theme;

  const setTheme = (newTheme: "light" | "dark" | "system") => {
    updateSettings({ theme: newTheme });
  };

  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)")
        .matches
        ? "dark"
        : "light";
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
  }, [theme]);

  useEffect(() => {
    console.log(
      "[StateMachineProvider] hasUnsavedChanges changed to",
      hasUnsavedChanges,
    );
  }, [hasUnsavedChanges]);

  const { setItems: setLibraryItems, setCategories: setLibraryCategories } =
    useLibraryStore();

  useEffect(() => {
    let isMounted = true;

    const loadData = async () => {
      try {
        const [receivedFlowData, receivedLibraryData, receivedTimelineData] =
          await Promise.all([
            window.electron.loadData().catch((err) => {
              console.error("Failed to load flow data", err);
              return null;
            }),
            window.electron.loadLibrary().catch((err) => {
              console.error("Failed to load library data", err);
              return null;
            }),
            window.electron.loadTimeline().catch((err) => {
              console.error("Failed to load timeline data", err);
              return null;
            }),
          ]);

        if (!isMounted) return;

        if (receivedFlowData) {
          const newFlowData = JSON.parse(receivedFlowData);
          if (newFlowData && Array.isArray(newFlowData.nodes)) {
            newFlowData.nodes = newFlowData.nodes.map((node: any) => {
              if (node.data) {
                const {
                  isPlaying,
                  isPreviewActive,
                  isRecording,
                  isStreaming,
                  ...cleanData
                } = node.data;
                return {
                  ...node,
                  data: cleanData,
                };
              }
              return node;
            });
          }
          // ── Migrate standalone overlayThemeNodes into their connected targetOutputNode ──
          if (Array.isArray(newFlowData.nodes) && Array.isArray(newFlowData.edges)) {
            const themeNodes = newFlowData.nodes.filter((n: any) => n.type === "overlayThemeNode");
            if (themeNodes.length > 0) {
              const nodeMap = new Map(newFlowData.nodes.map((n: any) => [n.id, n]));
              for (const tn of themeNodes) {
                // Find the edge connecting this theme node to a targetOutputNode
                const edge = newFlowData.edges.find(
                  (e: any) => e.source === tn.id && nodeMap.get(e.target)?.type === "targetOutputNode"
                );
                if (edge) {
                  const outputNode = nodeMap.get(edge.target) as any;
                  if (outputNode && !outputNode.data?.selectedThemeId) {
                    outputNode.data = {
                      ...outputNode.data,
                      selectedThemeId:       tn.data?.selectedThemeId ?? null,
                      themeLayout:           tn.data?.themeLayout ?? null,
                      themeVariables:        tn.data?.variables ?? {},
                      themeResolvedElements: tn.data?.resolvedElements ?? [],
                    };
                  }
                  // Remove the theme node and its edge
                  newFlowData.edges = newFlowData.edges.filter((e: any) => e.id !== edge.id);
                }
              }
              newFlowData.nodes = newFlowData.nodes.filter((n: any) => n.type !== "overlayThemeNode");
              console.log(`[Migration] Merged ${themeNodes.length} overlayThemeNode(s) into targetOutputNode`);
            }
          }

          setFlowData(newFlowData);
          console.log("New data set in FlowData");
        } else {
          setFlowData(defaultFlowData);
          console.log("FlowData set to Default Flow Data");
        }

        if (receivedLibraryData) {
          const newLibraryData = JSON.parse(receivedLibraryData);
          setLibraryItems(newLibraryData.items || []);
          const cats = newLibraryData.categories;
          if (!cats || cats.length === 0) {
            setLibraryCategories([
              {
                id: "default-music",
                icon: "message-circle-question-mark",
                name: "Music",
                color: "#acf",
              },
              {
                id: "default-sfx",
                icon: "message-circle-question-mark",
                name: "Sound Effects",
                color: "#caf",
              },
            ]);
          } else {
            const sanitizedCats = cats.map((cat: any) => ({
              ...cat,
              color:
                typeof cat.color === "string"
                  ? cat.color
                  : cat.id === "default-music"
                    ? "#acf"
                    : cat.id === "default-sfx"
                      ? "#caf"
                      : "#fcf",
            }));
            setLibraryCategories(sanitizedCats);
          }
          console.log("New library data set");
        } else {
          setLibraryItems([]);
          setLibraryCategories([
            {
              id: "default-music",
              icon: "message-circle-question-mark",
              name: "Music",
              color: "#acf",
            },
            {
              id: "default-sfx",
              icon: "message-circle-question-mark",
              name: "Sound Effects",
              color: "#caf",
            },
          ]);
        }

        if (receivedTimelineData) {
          const newTimelineData = JSON.parse(receivedTimelineData);
          // ensure it has tracks array
          if (!newTimelineData.tracks) newTimelineData.tracks = [];
          setTimelineData(newTimelineData);
          console.log("New timeline data set");
        } else {
          setTimelineData(defaultTimelineData);
        }

        setLoaded(true);
      } catch (error) {
        console.error("Fatal error during data load", error);
        if (!isMounted) return;
        setFlowData(defaultFlowData);
        setTimelineData(defaultTimelineData);
        setLibraryItems([]);
        setLoaded(true);
      }
    };

    if (!loaded) {
      loadData();
    }

    return () => {
      isMounted = false;
    };
  }, [loaded, setFlowData, setLibraryItems, setLibraryCategories]);

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
          loaded,
          hasUnsavedChanges,
          setHasUnsavedChanges,
          quitRequested,
          setQuitRequested,
          persistRequested,
          setPersistRequested,
          theme,
          setTheme,
        }}
      >
        {props.children}
        <SplashOverlay visible={!loaded} />
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
