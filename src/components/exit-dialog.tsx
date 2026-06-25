import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { appControl } from "@/utils/global";
import { useStateMachine } from "@/store/stateMachine";
import { useAtomValue } from "jotai";
import { flowHasUnsavedChangesAtom } from "@/store/flowStore";
import { sonicsHasUnsavedChangesAtom } from "@/store/timelineStore";
import { Button } from "@/components/ui/button";

export const ExitDialog = () => {
  const { quitRequested, setQuitRequested } = useStateMachine();
  
  const flowUnsaved = useAtomValue(flowHasUnsavedChangesAtom);
  const sonicsUnsaved = useAtomValue(sonicsHasUnsavedChangesAtom);

  const hasUnsavedChanges = flowUnsaved || sonicsUnsaved;

  if (quitRequested && hasUnsavedChanges) {
    const unsavedSections: string[] = [];
    if (sonicsUnsaved) unsavedSections.push("Sonics");
    if (flowUnsaved) unsavedSections.push("Flow");

    return (
      <Dialog open={true} modal={true}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
          </DialogHeader>
          <div className="text-foreground/80 py-4">
            The following sections have unsaved changes:
            <ul className="list-disc pl-6 pt-2 font-semibold text-red-400">
              {unsavedSections.map((section) => (
                <li key={section}>{section}</li>
              ))}
            </ul>
            <p className="pt-4">Are you sure you want to exit without saving?</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuitRequested(false)}>Cancel</Button>
            <Button variant="destructive" onClick={() => appControl("closeApp")}>Discard & Exit</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  } else if (quitRequested) {
    appControl("closeApp");
    return null;
  }
  return null;
};
