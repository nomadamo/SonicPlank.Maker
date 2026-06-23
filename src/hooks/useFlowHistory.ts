import { useEffect } from "react";
import { useSetAtom, useAtomValue } from "jotai";
import {
  undoFlowAtom,
  redoFlowAtom,
  canUndoFlowAtom,
  canRedoFlowAtom,
} from "@/store/flowStore";

export function useFlowHistory() {
  const undo = useSetAtom(undoFlowAtom);
  const redo = useSetAtom(redoFlowAtom);
  const canUndo = useAtomValue(canUndoFlowAtom);
  const canRedo = useAtomValue(canRedoFlowAtom);

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
