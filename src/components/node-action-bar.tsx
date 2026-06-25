import { Button } from "@/components/ui/button";
import {
  InfoIcon,
  TablePropertiesIcon,
  Trash2Icon,
  XCircleIcon,
  CopyIcon,
} from "lucide-react";
import {
  ActionBar,
  ActionBarBody,
  ActionBarContent,
  ActionBarSeparator,
} from "@/components/ui/action-bar";
import { motion } from "motion/react";
import { useLayoutEffect, useState } from "react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { FlowNodeType } from "@/types/flow-node";
import { NodePropertiesDialog } from "@/components/node-properties-dialog";
import { useViewport } from "@xyflow/react";

export default function NodeActionBar({
  nodes,
  onDelete,
  onDuplicate,
}: {
  nodes: FlowNodeType[];
  onDelete?: (ids: string[]) => void;
  onDuplicate?: (ids: string[]) => void;
}) {
  const [key, setKey] = useState(0);
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const { zoom } = useViewport();

  useLayoutEffect(() => {
    setKey(nodes.length * Math.random());
  }, [nodes]);

  const selectedNode = nodes[0] ?? null;

  return (
    <>
      {nodes.length === 1 ? (
        <motion.div
          key={key}
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
              placement: "float-bottom",
              gutter: "20px",
              anchor: `--${nodes[0]?.type}_${nodes[0]?.id}`,
            }}
          >
            <ActionBarContent
              style={{
                boxShadow: "0 0px 24px rgba(0, 0, 0, 0.45)",
                transform: `scale(${zoom})`,
                transformOrigin: "top center",
              }}
            >
              <ActionBarBody>
                <ActionSelector
                  nodes={nodes}
                  onDelete={onDelete}
                  onDuplicate={onDuplicate}
                  onOpenProperties={() => setPropertiesOpen(true)}
                />
              </ActionBarBody>
            </ActionBarContent>
          </ActionBar>
        </motion.div>
      ) : (
        <></>
      )}

      {/* Properties dialog — rendered outside the action bar so it's not clipped */}
      <NodePropertiesDialog
        node={selectedNode}
        open={propertiesOpen}
        onOpenChange={setPropertiesOpen}
      />
    </>
  );
}

function ActionSelector({
  nodes,
  onDelete,
  onDuplicate,
  onOpenProperties,
}: {
  nodes: FlowNodeType[];
  onDelete?: (ids: string[]) => void;
  onDuplicate?: (ids: string[]) => void;
  onOpenProperties?: () => void;
}) {
  const node = nodes[0];
  const allIds = nodes.map((n) => n.id);
  const type = node?.type;

  // Constraints: Duplicate is disabled for limit-1 nodes (targetOutputNode)
  const isDuplicateDisabled = type === "targetOutputNode";

  return (
    <>
      {["audioFlowNode", "captureSourceNode", "targetOutputNode", "textOverlayNode", "colorOverlayNode", "imageOverlayNode", "visualizerOverlayNode"].includes(type || "") && (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" onClick={onOpenProperties}>
                <TablePropertiesIcon />
              </Button>
            }
          />
          <TooltipContent>Properties</TooltipContent>
        </Tooltip>
      )}

      <Tooltip>
        <TooltipTrigger
          render={
            <Button 
              variant="ghost" 
              disabled={isDuplicateDisabled}
              onClick={() => !isDuplicateDisabled && onDuplicate?.(allIds)}
            >
              <CopyIcon />
            </Button>
          }
        />
        <TooltipContent>
          {isDuplicateDisabled ? "Duplicate (Limit 1)" : "Duplicate"}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="destructive" onClick={() => onDelete?.(allIds)}>
              <Trash2Icon />
            </Button>
          }
        />
        <TooltipContent>
          Delete
        </TooltipContent>
      </Tooltip>

      <ActionBarSeparator />

      <Tooltip>
        <TooltipTrigger>
          <InfoIcon className="w-5 h-5 text-muted-foreground" />
        </TooltipTrigger>
        <TooltipContent>
          {type === "audioFlowNode" && (
            <>
              {node.data.title || "Unknown Title"}
              {" by "}
              {node.data.artist || "Unknown Artist"}
            </>
          )}
          {type === "captureSourceNode" && (
            <>Capture: {node.data.captureSourceName || "No source selected"}</>
          )}
          {type === "targetOutputNode" && (
            <>Compositor Output Node</>
          )}
          {type === "masterOutputNode" && (
            <>Master Speaker Output</>
          )}
          {type === "textOverlayNode" && (
            <>Text Overlay: "{node.data.textContent || "Watermark"}"</>
          )}
          {type === "colorOverlayNode" && (
            <>Color Overlay: {node.data.backgroundColor || "#4f46e5"}</>
          )}
          {type === "imageOverlayNode" && (
            <>Image Overlay: {node.data.imagePath ? String(node.data.imagePath).split(/[/\\]/).pop() : "None"}</>
          )}
          {type === "visualizerOverlayNode" && (
            <>Audio Visualizer layer</>
          )}
          {type === "overlayGroupNode" && (
            <>Overlay Compositor Node</>
          )}
        </TooltipContent>
      </Tooltip>
    </>
  );
}
