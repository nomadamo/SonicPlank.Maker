import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useSetAtom, useAtomValue } from "jotai";
import { updateNodeDataAtom, flowNodesAtom, flowDataAtom, flowEdgesAtom } from "@/store/flowStore";
import { useStateMachine } from "@/store/stateMachine";
import { toast } from "sonner";
import * as React from "react";
import { useState, useMemo, useCallback } from "react";
import type { ComponentProps } from "react";
import { NodePropertiesDialog } from "./node-properties-dialog";
import { FlowNodeType } from "@/types/flow-node";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  TableProperties as TablePropertiesIcon,
  Copy as CopyIcon,
  Trash2 as Trash2Icon,
} from "lucide-react";

export function BaseNode({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "bg-card text-card-foreground relative rounded-md border",
        "hover:ring-1",
        "in-[.selected]:border-muted-foreground",
        "in-[.selected]:shadow-lg",
        className,
      )}
      tabIndex={0}
      {...props}
    />
  );
}

export function BaseNodeHeader({
  className,
  ...props
}: ComponentProps<"header">) {
  return (
    <header
      {...props}
      className={cn(
        "mx-0 my-0 -mb-1 flex flex-row items-center justify-between gap-2 px-3 py-2",
        className,
      )}
    />
  );
}

export function BaseNodeHeaderTitle({
  className,
  ...props
}: ComponentProps<"h3">) {
  return (
    <h3
      data-slot="base-node-title"
      className={cn("user-select-none flex-1 font-semibold", className)}
      {...props}
    />
  );
}

export function BaseNodeContent({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      data-slot="base-node-content"
      className={cn("flex flex-col gap-y-2 p-3", className)}
      {...props}
    />
  );
}

export function BaseNodeFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      data-slot="base-node-footer"
      className={cn(
        "flex flex-col items-center gap-y-2 border-t px-3 pt-2 pb-3",
        className,
      )}
      {...props}
    />
  );
}

const borderColors = {
  emerald: "border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.35)] ring-1 ring-emerald-500/30",
  indigo: "border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.35)] ring-1 ring-indigo-500/30",
  cyan: "border-cyan-500 shadow-[0_0_15px_rgba(6,182,212,0.35)] ring-1 ring-cyan-500/30",
  purple: "border-purple-500 shadow-[0_0_15px_rgba(168,85,247,0.35)] ring-1 ring-purple-500/30",
  rose: "border-rose-500 shadow-[0_0_15px_rgba(244,63,94,0.35)] ring-1 ring-rose-500/30",
  pink: "border-pink-500 shadow-[0_0_15px_rgba(236,72,153,0.35)] ring-1 ring-pink-500/30",
  orange: "border-orange-500 shadow-[0_0_15px_rgba(249,115,22,0.35)] ring-1 ring-orange-500/30",
  amber: "border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.35)] ring-1 ring-amber-500/30",
  red: "border-red-500 shadow-[0_0_15px_rgba(239,68,68,0.35)] ring-1 ring-red-500/30",
  zinc: "border-zinc-500 shadow-[0_0_15px_rgba(113,113,122,0.35)] ring-1 ring-zinc-500/30",
};

const iconColors = {
  emerald: "bg-emerald-500/10 border-emerald-500/20 text-emerald-400",
  indigo: "bg-indigo-500/10 border-indigo-500/20 text-indigo-400",
  cyan: "bg-cyan-500/10 border-cyan-500/20 text-cyan-400",
  purple: "bg-purple-500/10 border-purple-500/20 text-purple-400",
  rose: "bg-rose-500/10 border-rose-500/20 text-rose-400",
  pink: "bg-pink-500/10 border-pink-500/20 text-pink-400",
  orange: "bg-orange-500/10 border-orange-500/20 text-orange-400",
  amber: "bg-amber-500/10 border-amber-500/20 text-amber-400",
  red: "bg-red-500/10 border-red-500/20 text-red-400",
  zinc: "bg-zinc-500/10 border-zinc-500/20 text-zinc-400",
};

interface BaseNodeCardProps {
  id: string;
  selected?: boolean;
  isMinimized?: boolean;
  borderColor?: keyof typeof borderColors;
  iconColor?: keyof typeof iconColors;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
  headerActions?: React.ReactNode;
  anchorName?: string;
  className?: string;
}

export function BaseNodeCard({
  id,
  selected = false,
  isMinimized = false,
  borderColor = "zinc",
  iconColor = "zinc",
  icon: IconComponent,
  title,
  subtitle,
  children,
  headerActions,
  anchorName,
  className,
}: BaseNodeCardProps) {
  const updateNodeData = useSetAtom(updateNodeDataAtom);
  const nodes = useAtomValue(flowNodesAtom);
  const setNodes = useSetAtom(flowNodesAtom);
  const setEdges = useSetAtom(flowEdgesAtom);
  const { setHasUnsavedChanges, setPersistRequested } = useStateMachine();

  const [propertiesOpen, setPropertiesOpen] = useState(false);

  // Find the node object to get its type
  const nodeObj = useMemo(() => nodes.find((n) => n.id === id), [nodes, id]);
  const nodeType = nodeObj?.type;

  const toggleMinimize = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    updateNodeData({
      id,
      patch: { isMinimized: !isMinimized },
    });
  };

  const deleteNode = useCallback(() => {
    setNodes((currentNodes) => currentNodes.filter((n) => n.id !== id));
    setEdges((currentEdges) =>
      currentEdges.filter((e) => e.source !== id && e.target !== id),
    );
    setPersistRequested(true);
    setHasUnsavedChanges(true);
    toast("Node deleted");
  }, [id, setNodes, setEdges, setPersistRequested, setHasUnsavedChanges]);

  const isDuplicateDisabled = nodeType === "targetOutputNode";

  const duplicateNode = useCallback(() => {
    if (isDuplicateDisabled) return;
    setNodes((currentNodes) => {
      const nodeToDuplicate = currentNodes.find((n) => n.id === id);
      if (!nodeToDuplicate) return currentNodes;
      const newNode: FlowNodeType = {
        ...nodeToDuplicate,
        id: crypto.randomUUID(),
        position: {
          x: nodeToDuplicate.position.x + 50,
          y: nodeToDuplicate.position.y + 50,
        },
        selected: false,
      };
      return [...currentNodes, newNode];
    });
    setPersistRequested(true);
    setHasUnsavedChanges(true);
    toast("Node duplicated");
  }, [id, isDuplicateDisabled, setNodes, setPersistRequested, setHasUnsavedChanges]);

  const showProperties = [
    "audioFlowNode",
    "captureSourceNode",
    "targetOutputNode",
    "textOverlayNode",
    "colorOverlayNode",
    "imageOverlayNode",
    "visualizerOverlayNode",
  ].includes(nodeType || "");

  const borderClass = borderColors[borderColor] || borderColors.zinc;
  const iconClass = iconColors[iconColor] || iconColors.zinc;

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          <Card
            className={cn(
              "w-80 panel flex flex-col select-none bg-zinc-950/95 backdrop-blur-md border text-white rounded-xl shadow-2xl transition-all duration-200",
              isMinimized ? "p-3.5 gap-0" : "p-4 gap-4",
              selected ? borderClass : "border-zinc-800",
              className
            )}
            id={`flow-node-${id}`}
            style={{ anchorName } as React.CSSProperties}
          >
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button className={cn("p-2 rounded-lg border outline-none focus:ring-1 focus:ring-zinc-400 nodrag nopan nowheel cursor-pointer", iconClass)}>
                        <IconComponent className="w-5 h-5 shrink-0" />
                      </button>
                    }
                  />
                  <DropdownMenuContent align="start" className="bg-zinc-950/95 border border-zinc-800 text-zinc-100 backdrop-blur-md rounded-lg shadow-xl min-w-40 p-1 nodrag nopan nowheel z-[9999]">
                    {showProperties && (
                      <DropdownMenuItem
                        onClick={() => setPropertiesOpen(true)}
                        className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 hover:text-white rounded cursor-pointer"
                      >
                        <TablePropertiesIcon className="w-4 h-4 text-zinc-400" />
                        Properties
                      </DropdownMenuItem>
                    )}
                    <DropdownMenuItem
                      disabled={isDuplicateDisabled}
                      onClick={duplicateNode}
                      className={cn(
                        "flex items-center gap-2 px-2.5 py-1.5 text-xs rounded cursor-pointer",
                        isDuplicateDisabled
                          ? "text-zinc-600 cursor-not-allowed opacity-50"
                          : "text-zinc-200 hover:bg-zinc-800 hover:text-white"
                      )}
                    >
                      <CopyIcon className="w-4 h-4 text-zinc-400" />
                      Duplicate {isDuplicateDisabled && "(Limit 1)"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={deleteNode}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-rose-400 hover:bg-rose-950/30 hover:text-rose-300 rounded cursor-pointer"
                    >
                      <Trash2Icon className="w-4 h-4 text-rose-400" />
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <div>
                  <h4 className="text-sm font-semibold text-zinc-100">{title}</h4>
                  {subtitle && <p className="text-[11px] text-zinc-400">{subtitle}</p>}
                </div>
              </div>

              <div className="flex items-center gap-2 nodrag nopan nowheel">
                {headerActions}
                <button
                  onClick={toggleMinimize}
                  className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-zinc-100 transition-colors cursor-pointer"
                  title={isMinimized ? "Expand" : "Collapse"}
                >
                  {isMinimized ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronUp className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Body Content */}
            {!isMinimized && children}
          </Card>
        }
      />
      <ContextMenuContent className="bg-zinc-950/95 border border-zinc-800 text-zinc-100 backdrop-blur-md rounded-lg shadow-xl min-w-40 p-1 nodrag nopan nowheel z-[9999]">
        {showProperties && (
          <ContextMenuItem
            onClick={() => setPropertiesOpen(true)}
            className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-zinc-200 hover:bg-zinc-800 hover:text-white rounded cursor-pointer"
          >
            <TablePropertiesIcon className="w-4 h-4 text-zinc-400" />
            Properties
          </ContextMenuItem>
        )}
        <ContextMenuItem
          disabled={isDuplicateDisabled}
          onClick={duplicateNode}
          className={cn(
            "flex items-center gap-2 px-2.5 py-1.5 text-xs rounded cursor-pointer",
            isDuplicateDisabled
              ? "text-zinc-600 cursor-not-allowed opacity-50"
              : "text-zinc-200 hover:bg-zinc-800 hover:text-white"
          )}
        >
          <CopyIcon className="w-4 h-4 text-zinc-400" />
          Duplicate {isDuplicateDisabled && "(Limit 1)"}
        </ContextMenuItem>
        <ContextMenuItem
          onClick={deleteNode}
          className="flex items-center gap-2 px-2.5 py-1.5 text-xs text-rose-400 hover:bg-rose-950/30 hover:text-rose-300 rounded cursor-pointer"
        >
          <Trash2Icon className="w-4 h-4 text-rose-400" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>

      <NodePropertiesDialog
        node={nodeObj ?? null}
        open={propertiesOpen}
        onOpenChange={setPropertiesOpen}
      />
    </ContextMenu>
  );
}
