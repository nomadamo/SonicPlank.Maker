import { useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useLibraryStore } from "@/store/libraryStore";
import { useAtom } from "jotai";
import { flowNodesAtom } from "@/store/flowStore";
import type { LibraryItem } from "@/types/library-item";
import { MusicIcon, PlusCircleIcon, WorkflowIcon } from "lucide-react";

interface AddFromLibraryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  getCenterPosition?: () => { x: number; y: number };
}

function formatDuration(seconds: number | undefined | null): string {
  if (!seconds) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function AddFromLibraryDialog({
  open,
  onOpenChange,
  getCenterPosition,
}: AddFromLibraryDialogProps) {
  const { items } = useLibraryStore();
  const displayItems = items.filter((item) => !item.isStream);
  const [flowNodes, setFlowNodes] = useAtom(flowNodesAtom);

  const handleAdd = useCallback(
    (item: LibraryItem) => {
      const nodeCount = flowNodes?.length || 0;
      const offset = (nodeCount % 8) * 30;
      const position = getCenterPosition
        ? getCenterPosition()
        : { x: 140 + offset, y: 140 + offset };
      const newNode = {
        id: crypto.randomUUID(),
        type: "audioFlowNode" as const,
        position,
        data: {
          title: item.title,
          artist: item.artist,
          mediaPath: item.filePath,
          volume: 1,
          duration: item.duration,
        },
      };
      setFlowNodes((prev) => [...(prev || []), newNode]);
      onOpenChange(false);
    },
    [flowNodes, setFlowNodes, onOpenChange, getCenterPosition],
  );

  const isEmpty = displayItems.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: "520px", maxHeight: "640px" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <WorkflowIcon className="h-5 w-5 text-primary" />
            Add from Library
          </DialogTitle>
          <DialogDescription>
            Click a track to add it as a node in the flow editor.
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <div
          style={{
            overflowY: "auto",
            maxHeight: "460px",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            paddingRight: "4px",
          }}
        >
          {isEmpty ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center gap-3 py-12"
            >
              <MusicIcon
                className="text-muted-foreground"
                size={40}
                strokeWidth={1}
                style={{ opacity: 0.4 }}
              />
              <p className="text-sm text-muted-foreground text-center">
                Your library is empty. Add audio files in the Library tab first.
              </p>
            </motion.div>
          ) : (
            <AnimatePresence>
              {displayItems.map((item, index) => (
                <motion.button
                  key={item.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ delay: index * 0.03, duration: 0.15 }}
                  onClick={() => handleAdd(item)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-left w-full transition-colors hover:bg-accent hover:text-accent-foreground group"
                  style={{
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                  }}
                >
                  {/* Album art thumbnail */}
                  <div className="h-10 w-10 rounded-md bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                    {item.albumArt ? (
                      <img
                        src={item.albumArt}
                        alt={item.title}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <MusicIcon
                        className="text-muted-foreground opacity-50"
                        size={18}
                        strokeWidth={1.5}
                      />
                    )}
                  </div>

                  {/* Metadata */}
                  <div className="flex flex-col flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{item.title}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {item.artist}
                      {item.duration
                        ? ` · ${formatDuration(item.duration)}`
                        : ""}
                    </p>
                  </div>

                  {/* Add icon */}
                  <PlusCircleIcon className="h-4 w-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                </motion.button>
              ))}
            </AnimatePresence>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
