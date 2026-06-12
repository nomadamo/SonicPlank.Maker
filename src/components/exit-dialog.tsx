import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { appControl } from "@/utils/global";
import { useStateMachine } from "@/store/stateMachine";
import { useAtomValue } from "jotai";
import { flowDataAtom } from "@/store/flowStore";
import { Button, type ButtonProps } from "@/components/ui/button";

type CommandButtonProps = ButtonProps & {
  command: string;
};

function CommandButton({ command, ...props }: CommandButtonProps) {
  const { variant = "outline", size = "default", ...rest } = props;

  const { setQuitRequested } = useStateMachine();
  const flowData = useAtomValue(flowDataAtom);

  function handleClick(result: string) {
    if (result == "discard") {
      appControl("closeApp");
    } else if (result == "save-exit") {
      window.electron
        .saveData(JSON.stringify(flowData))
        .catch((err) => console.error("[ExitDialog] Save failed:", err))
        .finally(() => appControl("closeApp"));
    } else if (result == "cancel") {
      setQuitRequested(false);
    }
  }

  return (
    <Button {...props} onClick={() => handleClick(command)}>
      {props.children}
    </Button>
  );
}

export const ExitDialog = () => {
  const { quitRequested, hasUnsavedChanges } = useStateMachine();

  if (quitRequested && hasUnsavedChanges) {
    return (
      <Dialog open={hasUnsavedChanges} modal={true}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>Unsaved changes</DialogTitle>
          </DialogHeader>
          <DialogFooter>
            <CommandButton command="cancel">Cancel</CommandButton>
            <CommandButton command="discard">Discard</CommandButton>
            <CommandButton command="save-exit" variant="destructive">
              Save & Exit
            </CommandButton>
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
