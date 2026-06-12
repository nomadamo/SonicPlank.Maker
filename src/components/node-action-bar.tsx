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

  useLayoutEffect(() => {
    setKey(nodes.length * Math.random());
  }, [nodes]);

  const selectedNode = nodes[0] ?? null;

  return (
    <>
      {nodes.length === 1 && nodes[0].type === "audioFlowNode" ? (
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
              anchor: `--audioNode_${nodes[0]?.id}`,
            }}
          >
            <ActionBarContent
              style={{
                boxShadow: "0 0px 24px rgba(0, 0, 0, 0.45)",
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
  const allIds = nodes.map((n) => n.id);
  const multiSelect = nodes.length > 1;

  return (
    <>
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

      <Tooltip>
        <TooltipTrigger
          render={
            <Button variant="ghost" onClick={() => onDuplicate?.(allIds)}>
              <CopyIcon />
            </Button>
          }
        />
        <TooltipContent>
          {multiSelect ? `Duplicate ${nodes.length} nodes` : "Duplicate"}
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
          {multiSelect ? `Delete ${nodes.length} nodes` : "Delete"}
        </TooltipContent>
      </Tooltip>

      <ActionBarSeparator />

      <Tooltip>
        <TooltipTrigger>
          <InfoIcon />
        </TooltipTrigger>
        <TooltipContent>
          {nodes[0]?.data?.title || "Unknown Title"}
          {" by "}
          {nodes[0]?.data?.artist || "Unknown Artist"}
          {multiSelect && ` (+${nodes.length - 1} more)`}
        </TooltipContent>
      </Tooltip>
    </>
  );
}
