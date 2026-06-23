import {
  addEdge,
  Controls,
  FitViewOptions,
  MiniMap,
  ReactFlow,
  useNodesState,
  useEdgesState,
  EdgeTypes,
  Panel,
  NodeChange,
  EdgeChange,
  useReactFlow,
} from "@xyflow/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AudioNode } from "@/components/audio-node";
import { MasterOutputNode } from "@/components/master-output-node";
import { CaptureSourceNode } from "@/components/capture-source-node";
import { TextOverlayNode } from "@/components/text-overlay-node";
import { ColorOverlayNode } from "@/components/color-overlay-node";
import { ImageOverlayNode } from "@/components/image-overlay-node";
import { VisualizerOverlayNode } from "@/components/visualizer-overlay-node";
import { TargetOutputNode } from "@/components/target-output-node";
import { OverlayGroupNode } from "@/components/overlay-group-node";
import { NowPlayingNode } from "@/components/now-playing-node";
import { GlobalAudioNode } from "@/components/global-audio-node";
import { TwitchChatNode } from "@/components/twitch-chat-node";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { AnimatedRoute } from "@/components/animated-route";
import { LoadingAnimation } from "@/components/animations/loading-animation";
import { motion } from "motion/react";
import ConnectionLine from "@/components/ConnectionLine";
import { useStateMachine } from "@/store/stateMachine";
import { useSettings } from "@/store/settingsStore";
import { FlowNodeType } from "@/types/flow-node";
// @ts-ignore
import "@xyflow/react/dist/style.css";
import { SonicBackground } from "@/components/sonicbackground";
import { isValidConnection } from "@/utils/flow-connections";
import {
  DownloadIcon,
  LibraryIcon,
  PlusIcon,
  SaveIcon,
  Trash2Icon,
  UploadIcon,
  WorkflowIcon,
  Monitor as MonitorIcon,
  Music as MusicIcon,
  Type as TypeIcon,
  Palette as PaletteIcon,
  Image as ImageIcon,
  Activity as ActivityIcon,
  Layers as LayersIcon,
  MessageSquare as MessageSquareIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { isGlobalPlayerActiveAtom } from "@/store/libraryStore";
import { useFlowHistory } from "@/hooks/useFlowHistory";
import {
  flowNodesAtom,
  flowEdgesAtom,
  flowViewportAtom,
  flowDataAtom,
  updateNodeDataAtom,
  flowHasUnsavedChangesAtom,
} from "@/store/flowStore";
import { executeNodeAction } from "@/utils/node-actions";
import { triggerNodeActionAtom } from "@/store/transientNodeStore";
import {
  ActionBar,
  ActionBarBody,
  ActionBarContent,
} from "@/components/ui/action-bar";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AddFromLibraryDialog } from "@/components/add-from-library-dialog";
// eslint-disable-next-line import/no-unresolved
import { AnimatedSvgEdge } from "@/components/animated-svg-edge";
import type { LibraryItem } from "@/types/library-item";
import { toast } from "sonner";

const nodeTypes = {
  audioFlowNode: AudioNode,
  globalAudioNode: GlobalAudioNode,
  masterOutputNode: MasterOutputNode,
  captureSourceNode: CaptureSourceNode,
  textOverlayNode: TextOverlayNode,
  colorOverlayNode: ColorOverlayNode,
  imageOverlayNode: ImageOverlayNode,
  visualizerOverlayNode: VisualizerOverlayNode,
  targetOutputNode: TargetOutputNode,
  overlayGroupNode: OverlayGroupNode,
  nowPlayingNode: NowPlayingNode,
  twitchChatNode: TwitchChatNode,
};

const edgeTypes: EdgeTypes = {
  default: AnimatedSvgEdge,
};

const fitViewOptions: FitViewOptions = {
  padding: "100px",
};

interface AddNodesMenuProps {
  setAddLibraryOpen: (open: boolean) => void;
  hasOutputNode: boolean;
  onAddOutputNode: () => void;
  onAddSourceNode: () => void;
  onAddTargetOutputNode: () => void;
  onAddTextOverlayNode: () => void;
  onAddColorOverlayNode: () => void;
  onAddImageOverlayNode: () => void;
  onAddVisualizerOverlayNode: () => void;
  onAddOverlayGroupNode: () => void;
  onAddNowPlayingNode: () => void;
  onAddGlobalAudioNode: () => void;
  onAddTwitchChatNode: () => void;
}

function AddNodesMenu({
  setAddLibraryOpen,
  hasOutputNode,
  onAddOutputNode,
  onAddSourceNode,
  onAddTargetOutputNode,
  onAddTextOverlayNode,
  onAddColorOverlayNode,
  onAddImageOverlayNode,
  onAddVisualizerOverlayNode,
  onAddOverlayGroupNode,
  onAddNowPlayingNode,
  onAddGlobalAudioNode,
  onAddTwitchChatNode,
}: AddNodesMenuProps) {
  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <MusicIcon className="text-emerald-400" />
          Audio & Outputs
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem onClick={() => setAddLibraryOpen(true)}>
            <MusicIcon className="text-emerald-400" />
            Local Audio Node
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddGlobalAudioNode}>
            <MusicIcon className="text-emerald-400" />
            Global Audio Node
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onAddOutputNode}>
            <WorkflowIcon className="text-blue-400" />
            Master Output Node
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <MonitorIcon className="text-indigo-400" />
          Capture Pipeline
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem onClick={onAddSourceNode}>
            <MonitorIcon className="text-indigo-400" />
            Capture Source
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddTargetOutputNode} disabled={hasOutputNode}>
            <MonitorIcon className="text-red-400" />
            Compositor Output
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <LayersIcon className="text-pink-400" />
          Visual Overlays
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem onClick={onAddOverlayGroupNode}>
            <LayersIcon className="text-indigo-400" />
            Overlay Compositor
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onAddTextOverlayNode}>
            <TypeIcon className="text-indigo-400" />
            Text Watermark
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddColorOverlayNode}>
            <PaletteIcon className="text-pink-400" />
            Color Block
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddImageOverlayNode}>
            <ImageIcon className="text-emerald-400" />
            Image Logo
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddVisualizerOverlayNode}>
            <ActivityIcon className="text-cyan-400" />
            Visualizer
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <MessageSquareIcon className="text-purple-400" />
          Integrations
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem onClick={onAddNowPlayingNode}>
            <MusicIcon className="text-indigo-400" />
            Now Playing
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddTwitchChatNode}>
            <MessageSquareIcon className="text-purple-400" />
            Twitch Chat
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}

export const Route = createFileRoute("/flow-editor")({
  component: FlowEditor,
  pendingComponent: LoadingAnimation,
});

function FlowEditor() {
  const {
    persistRequested,
    setPersistRequested,
  } = useStateMachine();
  const [hasUnsavedChanges, setHasUnsavedChanges] = useAtom(flowHasUnsavedChangesAtom);
  const flowNodesData = useAtomValue(flowNodesAtom);
  const flowEdgesData = useAtomValue(flowEdgesAtom);
  const flowViewportData = useAtomValue(flowViewportAtom);
  const setFlowData = useSetAtom(flowDataAtom);
  const { settings } = useSettings();
  const { screenToFlowPosition, addNodes } = useReactFlow();

  const navigate = useNavigate();
  const [selectedNodes, setSelectedNodes] = useState([] as FlowNodeType[]);
  const [currentNodes, setCurrentNodes, onNodesChange] =
    useNodesState(flowNodesData);
  const [currentEdges, setCurrentEdges, onEdgesChange] =
    useEdgesState(flowEdgesData);
  const [currentViewport, setCurrentViewport] = useState(flowViewportData);

  const updateNodeData = useSetAtom(updateNodeDataAtom);
  const isGlobalPlayerActive = useAtomValue(isGlobalPlayerActiveAtom);
  const runNodeAction = useSetAtom(triggerNodeActionAtom);
  const { undo, redo, canUndo, canRedo } = useFlowHistory();

  // Global keydown triggers handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 1. Skip if typing in an input, textarea or contenteditable element
      const activeEl = document.activeElement;
      if (
        activeEl?.tagName === "INPUT" ||
        activeEl?.tagName === "TEXTAREA" ||
        activeEl?.getAttribute("contenteditable") === "true"
      ) {
        return;
      }

      const key = e.code || e.key;
      const isModifier = [
        "Control",
        "ControlLeft",
        "ControlRight",
        "Shift",
        "ShiftLeft",
        "ShiftRight",
        "Alt",
        "AltLeft",
        "AltRight",
        "Meta",
        "MetaLeft",
        "MetaRight",
        "OSLeft",
        "OSRight",
      ].includes(key);

      if (isModifier) return;

      const modifiers: string[] = [];
      if (e.ctrlKey) modifiers.push("Ctrl");
      if (e.altKey) modifiers.push("Alt");
      if (e.shiftKey) modifiers.push("Shift");
      if (e.metaKey) modifiers.push("Meta");

      const eventHotkeyStr =
        modifiers.length > 0 ? `${modifiers.join("+")}+${key}` : key;

      // 2. Iterate through all nodes to find matching triggers
      currentNodes.forEach((node) => {
        const triggers = node.data?.triggers;
        if (!triggers || !Array.isArray(triggers)) return;

        triggers.forEach((trigger) => {
          if (trigger.triggerKey === eventHotkeyStr) {
            e.preventDefault();
            e.stopPropagation();

            console.log(
              `[Global Triggers] Trigger key "${key}" matched action "${trigger.action}" for node ${node.id} (${node.type})`,
            );

            // Execute the action via the transient action runner
            const result = runNodeAction({
              nodeId: node.id,
              nodeType: node.type || "",
              actionName: trigger.action,
            });

            if (result && result.patch) {
              // Update local state reactively if there is a persistent patch
              if (result.persistentPatch && Object.keys(result.persistentPatch).length > 0) {
                setCurrentNodes((prevNodes) =>
                  prevNodes.map((n) =>
                    n.id === node.id
                      ? { ...n, data: { ...n.data, ...result.persistentPatch } }
                      : n,
                  ),
                );
              }

              // Toast feedback
              const nodeName =
                node.data.title ||
                node.type?.replace("OverlayNode", "").replace("Node", "") ||
                "Node";
              toast.info(
                `Triggered "${trigger.action}" on "${nodeName}" (Key: ${eventHotkeyStr})`,
                {
                  position: "bottom-right",
                },
              );
            }
          }
        });
      });
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [currentNodes, setCurrentNodes, runNodeAction]);

  // Dialog states
  const [addLibraryOpen, setAddLibraryOpen] = useState(false);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [isAddPopoverOpen, setIsAddPopoverOpen] = useState(false);
  const [isEmptyPopoverOpen, setIsEmptyPopoverOpen] = useState(false);

  const hasOutputNode = currentNodes.some(
    (node) => node.type === "targetOutputNode",
  );

  // ─── Refs ───────────────────────────────────────────────────────────────────
  // Skips the debounced sync on the very first effect run. ReactFlow fires
  // NodeDimensionChange events when it measures node DOM elements immediately
  // after mount; without this guard those changes cause a spurious store write
  // → Store → ReactFlow echo → visible re-render on first navigation.
  const hasMountedRef = useRef(false);

  // Mirrors the last data we wrote to the jotai store.
  const latestFlowDataRef = useRef({
    nodes: flowNodesData,
    edges: flowEdgesData,
    viewport: flowViewportData,
  });

  // ─── IPC Overlays Update Subscription ───────────────────────────────────────
  useEffect(() => {
    window.electron.onOverlaysUpdated((updatedOverlays) => {
      console.log("[FlowEditor] Overlays updated from IPC:", updatedOverlays);
      if (!updatedOverlays) return;

      // Update coordinates of overlay nodes in flow editor state
      setCurrentNodes((prevNodes) => {
        let changed = false;
        let nextNodes = [...prevNodes];

        for (const overlay of updatedOverlays) {
          if (overlay.id.startsWith("pip::")) {
            const parts = overlay.id.split("::");
            if (parts.length === 3) {
              const groupId = parts[1];
              const sourceId = parts[2];
              
              const groupIndex = nextNodes.findIndex(n => n.id === groupId);
              if (groupIndex !== -1) {
                const groupNode = nextNodes[groupIndex];
                const storedRoles = (groupNode.data.sourceRoles as Record<string, any>) || {};
                const currentRole = storedRoles[sourceId];
                if (!currentRole || currentRole.pipX !== overlay.x || currentRole.pipY !== overlay.y || currentRole.pipW !== overlay.width || currentRole.pipH !== overlay.height) {
                  changed = true;
                  nextNodes[groupIndex] = {
                    ...groupNode,
                    data: {
                      ...groupNode.data,
                      sourceRoles: {
                        ...storedRoles,
                        [sourceId]: {
                          ...(currentRole || { role: "pip" }),
                          pipX: overlay.x,
                          pipY: overlay.y,
                          pipW: overlay.width,
                          pipH: overlay.height
                        }
                      }
                    }
                  };
                }
              }
            }
          } else {
            const nodeIndex = nextNodes.findIndex((n) => n.id === overlay.id);
            if (nodeIndex !== -1) {
              const node = nextNodes[nodeIndex];
              if (
                node.data.x !== overlay.x ||
                node.data.y !== overlay.y ||
                node.data.width !== overlay.width ||
                node.data.height !== overlay.height
              ) {
                changed = true;
                nextNodes[nodeIndex] = {
                  ...node,
                  data: {
                    ...node.data,
                    x: overlay.x,
                    y: overlay.y,
                    width: overlay.width,
                    height: overlay.height,
                  },
                };
              }
            }
          }
        }

        if (changed) {
          setHasUnsavedChanges(true);
          setPersistRequested(true);
          return nextNodes;
        }
        return prevNodes;
      });
    });

    return () => {
      window.electron.removeOnOverlaysUpdated(() => {});
    };
  }, [setCurrentNodes, setHasUnsavedChanges, setPersistRequested]);

  // ─── Store → ReactFlow sync ─────────────────────────────────────────────────
  useEffect(() => {
    if (latestFlowDataRef.current.nodes === flowNodesData) return;
    setCurrentNodes(flowNodesData || []);
    setPersistRequested(true);
    setHasUnsavedChanges(true);
  }, [flowNodesData, setCurrentNodes, setPersistRequested, setHasUnsavedChanges]);

  useEffect(() => {
    if (latestFlowDataRef.current.edges === flowEdgesData) return;
    setCurrentEdges(flowEdgesData || []);
    setPersistRequested(true);
    setHasUnsavedChanges(true);
  }, [flowEdgesData, setCurrentEdges, setPersistRequested, setHasUnsavedChanges]);

  // ─── ReactFlow → Store sync (debounced 200ms) ───────────────────────────────
  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    const timer = setTimeout(() => {
      const hasPendingChanges =
        latestFlowDataRef.current.nodes !== currentNodes ||
        latestFlowDataRef.current.edges !== currentEdges ||
        latestFlowDataRef.current.viewport !== currentViewport;
      if (hasPendingChanges) {
        setFlowData({
          nodes: currentNodes,
          edges: currentEdges,
          viewport: currentViewport,
        });
        latestFlowDataRef.current = {
          nodes: currentNodes,
          edges: currentEdges,
          viewport: currentViewport,
        };
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [currentNodes, currentEdges, currentViewport, setFlowData]);

  // ─── Snapshot after Store → ReactFlow sync ─────────────────────────────────
  useEffect(() => {
    if (persistRequested) {
      latestFlowDataRef.current = {
        nodes: currentNodes,
        edges: currentEdges,
        viewport: currentViewport,
      };
      console.info("[FlowEditor] Changes persisted.");
      setPersistRequested(false);
    }
  }, [
    persistRequested,
    currentNodes,
    currentEdges,
    currentViewport,
    setPersistRequested,
  ]);

  // ─── Auto-save to disk ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!settings.autoSave) return;

    const timer = setInterval(() => {
      const data = latestFlowDataRef.current;
      window.electron
        .saveData(JSON.stringify(data))
        .then(() => {
          setHasUnsavedChanges(false);
          console.log(
            `[FlowEditor] Auto-saved (interval: ${settings.autoSaveIntervalMs}ms)`,
          );
        })
        .catch((err) => console.error("[FlowEditor] Auto-save failed:", err));
    }, settings.autoSaveIntervalMs);

    return () => clearInterval(timer);
  }, [settings.autoSave, settings.autoSaveIntervalMs]);

  // ─── Manual save ────────────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    const data = {
      nodes: currentNodes,
      edges: currentEdges,
      viewport: currentViewport,
    };
    window.electron
      .saveData(JSON.stringify(data))
      .then(() => {
        setHasUnsavedChanges(false);
        toast.success("Flow saved");
        console.log("[FlowEditor] Manually saved");
      })
      .catch((err) => {
        console.error("[FlowEditor] Save failed:", err);
        toast.error("Save failed");
      });
  }, [currentNodes, currentEdges, currentViewport]);

  // ─── Export ─────────────────────────────────────────────────────────────────
  const handleExport = useCallback(() => {
    const data = {
      nodes: currentNodes,
      edges: currentEdges,
      viewport: currentViewport,
      exportedAt: new Date().toISOString(),
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sonicplank-flow-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Flow exported");
  }, [currentNodes, currentEdges, currentViewport]);

  // ─── Import ─────────────────────────────────────────────────────────────────
  const handleImport = useCallback(() => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const data = JSON.parse(content);
          if (data.nodes && data.edges && data.viewport) {
            setCurrentNodes(data.nodes);
            setCurrentEdges(data.edges);
            setCurrentViewport(data.viewport);
            setPersistRequested(true);
            setHasUnsavedChanges(true);
            toast.success("Flow imported successfully");
          } else {
            toast.error("Invalid flow file format");
          }
        } catch (err) {
          toast.error("Failed to parse flow file");
          console.error("[FlowEditor] Import failed:", err);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }, [
    setCurrentNodes,
    setCurrentEdges,
    setCurrentViewport,
    setPersistRequested,
  ]);

  // ─── Delete nodes ───────────────────────────────────────────────────────────
  const handleDelete = useCallback(
    (ids: string[]) => {
      setCurrentNodes((nodes) => nodes.filter((n) => !ids.includes(n.id)));
      setCurrentEdges((edges) =>
        edges.filter((e) => !ids.includes(e.source) && !ids.includes(e.target)),
      );
      setSelectedNodes([]);
      setPersistRequested(true);
      setHasUnsavedChanges(true);
    },
    [
      setCurrentNodes,
      setCurrentEdges,
      setPersistRequested,
      setHasUnsavedChanges,
    ],
  );

  // ─── Duplicate nodes ────────────────────────────────────────────────────────
  const handleDuplicate = useCallback(
    (ids: string[]) => {
      setCurrentNodes((nodes) => {
        const nodesToDuplicate = nodes.filter((n) => ids.includes(n.id));
        const newNodes = nodesToDuplicate.map((n) => ({
          ...n,
          id: crypto.randomUUID(),
          position: {
            x: n.position.x + 50,
            y: n.position.y + 50,
          },
          selected: false,
        }));
        return [...nodes, ...newNodes];
      });
      setPersistRequested(true);
      setHasUnsavedChanges(true);
      toast("Nodes duplicated");
    },
    [setCurrentNodes, setPersistRequested, setHasUnsavedChanges],
  );

  // ─── Clear canvas ───────────────────────────────────────────────────────────
  const handleClearCanvas = useCallback(() => {
    setCurrentNodes([]);
    setCurrentEdges([]);
    setSelectedNodes([]);
    setPersistRequested(true);
    setHasUnsavedChanges(true);
    toast("Canvas cleared");
  }, [
    setCurrentNodes,
    setCurrentEdges,
    setPersistRequested,
    setHasUnsavedChanges,
  ]);

  // ─── Edge / Node / Connection handlers ─────────────────────────────────────
  const onConnect = useCallback(
    (connection) => {
      setCurrentEdges((current) =>
        addEdge(
          {
            ...connection,
            data: { duration: 0.5, shape: "circle", direction: "forward" },
          },
          current,
        ),
      );
      setPersistRequested(true);
      setHasUnsavedChanges(true);
    },
    [setCurrentEdges, setPersistRequested, setHasUnsavedChanges],
  );

  const handleSelectionChange = useCallback((elements) => {
    setSelectedNodes(elements.nodes);
  }, []);

  const handleEdgesChange = useCallback(
    (changedEdges: EdgeChange[]) => {
      onEdgesChange(changedEdges);
      const isSignificant = changedEdges.some((c) => c.type !== "select");
      if (isSignificant) {
        setHasUnsavedChanges(true);
      }
    },
    [onEdgesChange, setHasUnsavedChanges],
  );

  const handleNodesChange = useCallback(
    (changedNodes: NodeChange[]) => {
      onNodesChange(changedNodes);
      const isSignificant = changedNodes.some((c) => {
        if (c.type === "dimensions" || c.type === "select") return false;
        if (c.type === "position" && c.dragging) return false;
        return true;
      });
      if (isSignificant) {
        setHasUnsavedChanges(true);
      }
    },
    [onNodesChange, setHasUnsavedChanges],
  );

  const handleIsValidConnection = useCallback(
    (connection: any) => {
      return isValidConnection(connection, currentNodes);
    },
    [currentNodes],
  );

  const handleConnect = useCallback(
    (connection: any) => {
      if (isValidConnection(connection, currentNodes)) {
        onConnect(connection);
      }
    },
    [onConnect, currentNodes],
  );

  // ─── Drag-and-drop from Library ─────────────────────────────────────────────
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  const getCenterProjectPosition = useCallback(() => {
    const bounds = reactFlowWrapper.current?.getBoundingClientRect();
    const w = bounds ? bounds.width : window.innerWidth;
    const h = bounds ? bounds.height : window.innerHeight;
    const jitterX = (Math.random() - 0.5) * 40;
    const jitterY = (Math.random() - 0.5) * 40;
    return {
      x: (w / 2 - currentViewport.x) / currentViewport.zoom + jitterX,
      y: (h / 2 - currentViewport.y) / currentViewport.zoom + jitterY,
    };
  }, [currentViewport]);

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();

      const raw = event.dataTransfer.getData(
        "application/sonicplank/library-item",
      );
      if (!raw) return;

      let item: LibraryItem;
      try {
        item = JSON.parse(raw) as LibraryItem;
      } catch {
        return;
      }

      if (item.isStream) return;

      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;
      const position = {
        x:
          (event.clientX - bounds.left - currentViewport.x) /
          currentViewport.zoom,
        y:
          (event.clientY - bounds.top - currentViewport.y) /
          currentViewport.zoom,
      };

      const newNode: FlowNodeType = {
        id: crypto.randomUUID(),
        type: "audioFlowNode",
        position,
        data: {
          title: item.title,
          artist: item.artist,
          mediaPath: item.filePath,
          volume: 1,
          duration: item.duration,
          albumArt: item.albumArt || "",
        },
      };
      setCurrentNodes((nodes) => [...nodes, newNode]);
      setPersistRequested(true);
      setHasUnsavedChanges(true);
    },
    [
      currentViewport,
      setCurrentNodes,
      setPersistRequested,
      setHasUnsavedChanges,
    ],
  );

  const onAddOutputNode = useCallback(() => {
    const newNode: FlowNodeType = {
      id: crypto.randomUUID(),
      type: "masterOutputNode",
      position: getCenterProjectPosition(),
      data: {
        title: "Master Output",
        artist: "",
        mediaPath: "",
        volume: 1,
        duration: 0,
      },
    };
    setCurrentNodes((nodes) => [...nodes, newNode]);
    setPersistRequested(true);
    setHasUnsavedChanges(true);
  }, [
    getCenterProjectPosition,
    setCurrentNodes,
    setPersistRequested,
    setHasUnsavedChanges,
  ]);

  const onAddGlobalAudioNode = useCallback(() => {
    const position = getCenterProjectPosition();
    const newNode: FlowNodeType = {
      id: crypto.randomUUID(),
      type: "globalAudioNode",
      position,
      data: {
        isMinimized: false,
      },
    };
    setCurrentNodes((nodes) => [...nodes, newNode]);
    setPersistRequested(true);
    setHasUnsavedChanges(true);
  }, [getCenterProjectPosition, setCurrentNodes, setPersistRequested, setHasUnsavedChanges]);

  const onAddSourceNode = useCallback(() => {
    const newNode: FlowNodeType = {
      id: crypto.randomUUID(),
      type: "captureSourceNode",
      position: getCenterProjectPosition(),
      data: {
        captureSourceId: "",
        captureSourceName: "",
        captureResolution: "original",
        captureAudio: false,
      },
    };
    setCurrentNodes((nodes) => [...nodes, newNode]);
    setPersistRequested(true);
    setHasUnsavedChanges(true);
  }, [
    getCenterProjectPosition,
    setCurrentNodes,
    setPersistRequested,
    setHasUnsavedChanges,
  ]);

  const onAddTextOverlayNode = useCallback(() => {
    const newNode: FlowNodeType = {
      id: crypto.randomUUID(),
      type: "textOverlayNode",
      position: getCenterProjectPosition(),
      data: {
        x: 10,
        y: 10,
        width: 40,
        height: 10,
        opacity: 1,
        textContent: "Watermark Text",
        fontSize: 5,
        textColor: "#ffffff",
      },
    };
    setCurrentNodes((nodes) => [...nodes, newNode]);
    setPersistRequested(true);
    setHasUnsavedChanges(true);
  }, [
    getCenterProjectPosition,
    setCurrentNodes,
    setPersistRequested,
    setHasUnsavedChanges,
  ]);

  const onAddColorOverlayNode = useCallback(() => {
    const newNode: FlowNodeType = {
      id: crypto.randomUUID(),
      type: "colorOverlayNode",
      position: getCenterProjectPosition(),
      data: {
        x: 10,
        y: 10,
        width: 30,
        height: 20,
        opacity: 1,
        backgroundColor: "#4f46e5",
      },
    };
    setCurrentNodes((nodes) => [...nodes, newNode]);
    setPersistRequested(true);
    setHasUnsavedChanges(true);
  }, [
    getCenterProjectPosition,
    setCurrentNodes,
    setPersistRequested,
    setHasUnsavedChanges,
  ]);

  const onAddImageOverlayNode = useCallback(() => {
    const newNode: FlowNodeType = {
      id: crypto.randomUUID(),
      type: "imageOverlayNode",
      position: getCenterProjectPosition(),
      data: {
        x: 10,
        y: 10,
        width: 30,
        height: 20,
        opacity: 1,
        imagePath: "",
      },
    };
    setCurrentNodes((nodes) => [...nodes, newNode]);
    setPersistRequested(true);
    setHasUnsavedChanges(true);
  }, [
    getCenterProjectPosition,
    setCurrentNodes,
    setPersistRequested,
    setHasUnsavedChanges,
  ]);

  const onAddVisualizerOverlayNode = useCallback(() => {
    const newNode: FlowNodeType = {
      id: crypto.randomUUID(),
      type: "visualizerOverlayNode",
      position: getCenterProjectPosition(),
      data: {
        x: 10,
        y: 70,
        width: 80,
        height: 20,
        opacity: 1,
        backgroundColor: "rgba(0, 0, 0, 0.3)",
      },
    };
    setCurrentNodes((nodes) => [...nodes, newNode]);
    setPersistRequested(true);
    setHasUnsavedChanges(true);
  }, [
    getCenterProjectPosition,
    setCurrentNodes,
    setPersistRequested,
    setHasUnsavedChanges,
  ]);

  const onAddOverlayGroupNode = useCallback(() => {
    const newNode: FlowNodeType = {
      id: crypto.randomUUID(),
      type: "overlayGroupNode",
      position: getCenterProjectPosition(),
      data: {
        title: "Overlay Compositor",
      },
    };
    setCurrentNodes((nodes) => [...nodes, newNode]);
    setPersistRequested(true);
    setHasUnsavedChanges(true);
  }, [
    getCenterProjectPosition,
    setCurrentNodes,
    setPersistRequested,
    setHasUnsavedChanges,
  ]);

  const onAddNowPlayingNode = useCallback(() => {
    const newNode: FlowNodeType = {
      id: crypto.randomUUID(),
      type: "nowPlayingNode",
      position: getCenterProjectPosition(),
      data: {
        x: 10,
        y: 10,
        width: 35,
        height: 12,
        opacity: 1,
      },
    };
    setCurrentNodes((nodes) => [...nodes, newNode]);
    setPersistRequested(true);
    setHasUnsavedChanges(true);
  }, [
    getCenterProjectPosition,
    setCurrentNodes,
    setPersistRequested,
    setHasUnsavedChanges,
  ]);

  const onAddTwitchChatNode = useCallback(() => {
    const newNode: FlowNodeType = {
      id: crypto.randomUUID(),
      type: "twitchChatNode",
      position: getCenterProjectPosition(),
      data: {
        x: 2,
        y: 50,
        width: 28,
        height: 38,
        opacity: 0.9,
      },
    };
    setCurrentNodes((nodes) => [...nodes, newNode]);
    setPersistRequested(true);
    setHasUnsavedChanges(true);
  }, [
    getCenterProjectPosition,
    setCurrentNodes,
    setPersistRequested,
    setHasUnsavedChanges,
  ]);

  const onAddTargetOutputNode = useCallback(() => {
    const newNode: FlowNodeType = {
      id: crypto.randomUUID(),
      type: "targetOutputNode",
      position: getCenterProjectPosition(),
      data: {
        title: "Compositor Output",
      },
    };
    setCurrentNodes((nodes) => [...nodes, newNode]);
    setPersistRequested(true);
    setHasUnsavedChanges(true);
  }, [
    getCenterProjectPosition,
    setCurrentNodes,
    setPersistRequested,
    setHasUnsavedChanges,
  ]);

  const isEmpty =
    !currentNodes || currentNodes == null || currentNodes.length === 0;

  return (
    <AnimatedRoute variant="fade">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ delay: 0.25 }}
        style={{
          overflow: "hidden",
        }}
      >
        <div
          ref={reactFlowWrapper}
          style={{
            width: "100vw",
            marginTop: "0px",
            height: "calc(100vh - 65px)",
            overflow: "hidden",
          }}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            id="reactFlowProvider"
            nodes={currentNodes}
            nodeTypes={nodeTypes}
            edges={currentEdges}
            edgeTypes={edgeTypes}
            minZoom={0.5}
            maxZoom={2}
            fitView={!isEmpty}
            fitViewOptions={fitViewOptions}
            connectionLineComponent={ConnectionLine}
            proOptions={{ hideAttribution: true }}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            isValidConnection={handleIsValidConnection}
            onSelectionChange={handleSelectionChange}
            defaultViewport={flowViewportData}
            onViewportChange={setCurrentViewport}
            deleteKeyCode={["Delete", "Backspace"]}
            onNodesDelete={(deleted) => handleDelete(deleted.map((n) => n.id))}
          >
            <div className="flex w-[130]">
              {/* Main Action Bar */}
              {!isEmpty && (
                <motion.div
                  initial={{
                    opacity: 0,
                    y: 10,
                    transition: { duration: 0.25, ease: "easeInOut" },
                  }}
                  exit={{
                    opacity: 0,
                    y: -10,
                    transition: { duration: 0.25, ease: "easeInOut" },
                  }}
                  animate={{
                    opacity: 1,
                    y: 0,
                    transition: { duration: 0.25, ease: "easeInOut" },
                  }}
                >
                  <ActionBar
                    open={true}
                    positioning={{
                      placement: "bottom",
                      gutter: isGlobalPlayerActive ? "130px" : "20px",
                    }}
                  >
                    <ActionBarContent
                      style={{
                        boxShadow: "0 0px 24px rgba(0, 0, 0, 0.45)",
                      }}
                    >
                      <ActionBarBody>
                        {/* Add Nodes Dropdown */}
                        <DropdownMenu
                          open={isAddPopoverOpen}
                          onOpenChange={setIsAddPopoverOpen}
                        >
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <DropdownMenuTrigger
                                  render={
                                    <Button variant="ghost">
                                      <PlusIcon />
                                    </Button>
                                  }
                                />
                              }
                            />
                            <TooltipContent>Add Node</TooltipContent>
                          </Tooltip>

                          <DropdownMenuContent className="w-48">
                            <AddNodesMenu
                              setAddLibraryOpen={setAddLibraryOpen}
                              hasOutputNode={hasOutputNode}
                              onAddOutputNode={onAddOutputNode}
                              onAddSourceNode={onAddSourceNode}
                              onAddTargetOutputNode={onAddTargetOutputNode}
                              onAddTextOverlayNode={onAddTextOverlayNode}
                              onAddColorOverlayNode={onAddColorOverlayNode}
                              onAddImageOverlayNode={onAddImageOverlayNode}
                              onAddVisualizerOverlayNode={
                                onAddVisualizerOverlayNode
                              }
                              onAddOverlayGroupNode={onAddOverlayGroupNode}
                              onAddNowPlayingNode={onAddNowPlayingNode}
                              onAddGlobalAudioNode={onAddGlobalAudioNode}
                              onAddTwitchChatNode={onAddTwitchChatNode}
                            />
                          </DropdownMenuContent>
                        </DropdownMenu>

                        {/* Save */}
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                disabled={!hasUnsavedChanges}
                                variant="ghost"
                                onClick={handleSave}
                                className="relative"
                              >
                                <SaveIcon />
                                {hasUnsavedChanges && (
                                  <div className="absolute top-0 right-0 h-2 w-2 rounded-full bg-red-500 dark:bg-red-400" />
                                )}
                              </Button>
                            }
                          ></TooltipTrigger>
                          <TooltipContent>Save</TooltipContent>
                        </Tooltip>

                        {/* Export */}
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                disabled={isEmpty}
                                onClick={handleExport}
                              >
                                <DownloadIcon />
                              </Button>
                            }
                          />
                          <TooltipContent>Export JSON</TooltipContent>
                        </Tooltip>

                        {/* Import */}
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button variant="ghost" onClick={handleImport}>
                                <UploadIcon />
                              </Button>
                            }
                          />
                          <TooltipContent>Import JSON</TooltipContent>
                        </Tooltip>

                        {/* Clear canvas */}
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <Button
                                variant="ghost"
                                disabled={isEmpty}
                                onClick={() => setClearConfirmOpen(true)}
                              >
                                <Trash2Icon />
                              </Button>
                            }
                          />
                          <TooltipContent>Clear Canvas</TooltipContent>
                        </Tooltip>
                      </ActionBarBody>
                    </ActionBarContent>
                  </ActionBar>
                </motion.div>
              )}
            </div>
            <Controls position="bottom-left" style={{ marginBottom: isGlobalPlayerActive ? "140px" : "0" }} />
            <MiniMap position="bottom-left" className="left-10!" style={{ marginBottom: isGlobalPlayerActive ? "140px" : "0" }} />
            <SonicBackground />

            {/* Empty State */}
            {isEmpty && (
              <Panel className="absolute flex w-full! h-full! -top-4! -left-4!">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: 0.15, duration: 0.3 }}
                  className="flex flex-col items-center gap-4 mb-[1vh]"
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    flex: 1,
                    gap: "16px",
                  }}
                >
                  <WorkflowIcon
                    className="text-muted-foreground"
                    size={48}
                    strokeWidth={1.25}
                    style={{ opacity: 0.4 }}
                  />
                  <h1 className="text-2xl font-semibold text-foreground">
                    No nodes yet
                  </h1>
                  <p className="text-sm text-muted-foreground max-w-md text-center">
                    Add audio files from the Library, or drag tracks directly
                    onto the canvas
                  </p>
                  <div className="flex gap-2 mt-1">
                    <DropdownMenu
                      open={isEmptyPopoverOpen}
                      onOpenChange={setIsEmptyPopoverOpen}
                    >
                      <DropdownMenuTrigger
                        render={
                          <Button variant="outline" className="gap-2">
                            <PlusIcon className="h-4 w-4" />
                            Add Node
                          </Button>
                        }
                      />
                      <DropdownMenuContent className="w-48">
                        <AddNodesMenu
                          setAddLibraryOpen={setAddLibraryOpen}
                          hasOutputNode={hasOutputNode}
                          onAddOutputNode={onAddOutputNode}
                          onAddSourceNode={onAddSourceNode}
                          onAddTargetOutputNode={onAddTargetOutputNode}
                          onAddTextOverlayNode={onAddTextOverlayNode}
                          onAddColorOverlayNode={onAddColorOverlayNode}
                          onAddImageOverlayNode={onAddImageOverlayNode}
                          onAddVisualizerOverlayNode={
                            onAddVisualizerOverlayNode
                          }
                          onAddOverlayGroupNode={onAddOverlayGroupNode}
                          onAddNowPlayingNode={onAddNowPlayingNode}
                          onAddGlobalAudioNode={onAddGlobalAudioNode}
                          onAddTwitchChatNode={onAddTwitchChatNode}
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                    <Button
                      variant="ghost"
                      className="gap-2"
                      onClick={() => navigate({ to: "/" })}
                    >
                      <LibraryIcon className="h-4 w-4" />
                      Go to Library
                    </Button>
                  </div>
                </motion.div>
              </Panel>
            )}
          </ReactFlow>
        </div>
      </motion.div>

      {/* Add from Library dialog */}
      <AddFromLibraryDialog
        open={addLibraryOpen}
        onOpenChange={setAddLibraryOpen}
        getCenterPosition={getCenterProjectPosition}
      />

      {/* Clear canvas confirmation */}
      <AlertDialog open={clearConfirmOpen} onOpenChange={setClearConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear the canvas?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove all {currentNodes.length} node
              {currentNodes.length !== 1 ? "s" : ""} and all connections. This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleClearCanvas}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Clear Canvas
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AnimatedRoute>
  );
}
