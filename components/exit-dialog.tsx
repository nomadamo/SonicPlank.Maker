import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button, ButtonProps } from "@/components/ui/button";
import { appControl } from "@/utils/global";
import React from "react";
import { useStateMachine } from "@/store/stateMachine";

type CallbackButtonProps = ButtonProps & {
  command: string;
};

function CommandButton(props: CallbackButtonProps) {
  const {
    variant = "outline",
    size = "md",
    clickEffect = true,
    pill = false,
    isLoading = false,
    role = "button",
    color = "primary",
    ...rest
  } = props;

  const { setQuitRequested } = useStateMachine();

  function handleClick(result: string) {
    if (result == "discard") {
      appControl("closeApp");
    } else if (result == "save-exit") {
      // TODO: Implement save functionality
      appControl("closeApp");
    } else if (result == "cancel") {
      setQuitRequested(false);
    }
  }

  return (
    <Button {...props} onClick={() => handleClick(props.command)}>
      {props.children}
    </Button>
  );
}

export const ExitDialog = () => {
  const { quitRequested, setQuitRequested, hasUnsavedChanges } =
    useStateMachine();

  if (quitRequested && hasUnsavedChanges) {
    return (
      <Dialog open={hasUnsavedChanges} modal={true}>
        <DialogTrigger />
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
    return <></>;
  }
};
