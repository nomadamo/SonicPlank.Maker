import { useEffect } from "react";
import { useSetAtom, useAtomValue } from "jotai";
import {
  undoTimelineAtom,
  redoTimelineAtom,
  canUndoTimelineAtom,
  canRedoTimelineAtom,
} from "@/store/timelineStore";

export function useTimelineHistory() {
  const undo = useSetAtom(undoTimelineAtom);
  const redo = useSetAtom(redoTimelineAtom);
  const canUndo = useAtomValue(canUndoTimelineAtom);
  const canRedo = useAtomValue(canRedoTimelineAtom);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea
      const activeElement = document.activeElement;
      if (
        activeElement &&
        (activeElement.tagName === "INPUT" ||
          activeElement.tagName === "TEXTAREA" ||
          (activeElement as HTMLElement).isContentEditable)
      ) {
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (e.shiftKey) {
            redo();
          } else {
            undo();
          }
        } else if (e.key.toLowerCase() === "y") {
          e.preventDefault();
          redo();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  return { undo, redo, canUndo, canRedo };
}
