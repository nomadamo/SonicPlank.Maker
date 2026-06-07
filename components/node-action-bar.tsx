import { Button } from "@/components/ui/button";
import {
  ArchiveIcon,
  DownloadIcon,
  InfoIcon,
  PencilIcon,
  PlusIcon,
  SaveIcon,
  TablePropertiesIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  ActionBar,
  ActionBarBody,
  ActionBarContent,
  ActionBarSeparator,
  ActionBarValue,
} from "@/components/ui/action-bar";
import { motion } from "motion/react";
import { useLayoutEffect, useState } from "react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { FlowNodeType } from "@/types/flow-node";

export default function NodeActionBar({ nodes }: { nodes: FlowNodeType[] }) {
  const [key, setKey] = useState(0);

  useLayoutEffect(() => {
    setKey(nodes.length * Math.random());
  }, [nodes]);

  return (
    <motion.div
      key={key} // Re-render when the number of nodes changes
      initial={{
        opacity: 1,
        y: 0,
        x: 0,
        transition: { duration: 0.25, ease: "easeInOut" },
      }}
      exit={{
        opacity: 0,
        y: -75,
        x: -75,
        transition: { duration: 0.25, ease: "easeInOut" },
      }}
      animate={{
        opacity: 0,
        y: 75,
        x: 75,
        transition: { duration: 0.25, ease: "easeInOut" },
      }}
      transition={{ delay: 0, duration: 2000, ease: "easeInOut" }}
    >
      <ActionBar
        open={true}
        positioning={{
          placement: nodes.length == 1 ? "float-bottom" : "bottom",
          gutter: nodes.length == 1 ? "" : "20px",
          anchor: nodes.length == 1 ? `--audioNode_${nodes[0]?.id}` : "",
        }}
      >
        <ActionBarContent
          style={{
            boxShadow: "0 0px 24px rgba(0, 0, 0, 0.45)",
          }}
        >
          <ActionBarBody>
            <BodySelector nodes={nodes} />
          </ActionBarBody>
        </ActionBarContent>
      </ActionBar>
    </motion.div>
  );
}

function BodySelector({ nodes }: { nodes: FlowNodeType[] }) {
  // console.log("BodySelector received nodes:", [nodes]);
  if (nodes.length == 0) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost">
                <PlusIcon />
                {/* <span className="max-sm:sr-only"></span> */}
              </Button>
            }
          />
          <TooltipContent>Add</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost">
                <SaveIcon />
                {/* <span className="max-sm:sr-only"></span> */}
              </Button>
            }
          />
          <TooltipContent>Save</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost">
                <DownloadIcon />
                {/* <span className="max-sm:sr-only"></span> */}
              </Button>
            }
          />
          <TooltipContent>Export</TooltipContent>
        </Tooltip>
      </>
    );
  } else if (nodes.length == 1) {
    return (
      <>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost">
                <TablePropertiesIcon />
                {/* <span className="max-sm:sr-only"></span> */}
              </Button>
            }
          />
          <TooltipContent>Properties</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost">
                <PencilIcon />
                {/* <span className="max-sm:sr-only"></span> */}
              </Button>
            }
          />
          <TooltipContent>Edit</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost">
                <ArchiveIcon />
                {/* <span className="max-sm:sr-only"></span> */}
              </Button>
            }
          />
          <TooltipContent>Archive</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="destructive">
                <Trash2Icon />
                {/* <span className="max-sm:sr-only"></span> */}
              </Button>
            }
          />
          <TooltipContent>Delete</TooltipContent>
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
          </TooltipContent>
        </Tooltip>
      </>
    );
  } else {
    return (
      <>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost">
                <ArchiveIcon />
                {/* <span className="max-sm:sr-only"></span> */}
              </Button>
            }
          />
          <TooltipContent>Archive</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="destructive">
                <Trash2Icon />
                {/* <span className="max-sm:sr-only"></span> */}
              </Button>
            }
          />
          <TooltipContent>Delete All</TooltipContent>
        </Tooltip>
        <ActionBarSeparator />
        <ActionBarValue count={nodes.length} />
      </>
    );
  }
}
