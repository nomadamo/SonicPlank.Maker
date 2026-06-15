import React from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Progress } from "@/components/ui/progress";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";

type TaskStatus = "idle" | "running" | "success" | "error";

interface StatusDialogProps {
  status: TaskStatus;
  progress: number;
  title: string;
  errorMessage?: string;
}

export const StatusDialog: React.FC<StatusDialogProps> = ({
  status,
  progress,
  title,
  errorMessage,
}) => {
  const isOpen =
    status === "running" || status === "success" || status === "error";

  return (
    <AlertDialog open={isOpen}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center space-x-4">
            {/* Status Icons */}
            {status === "running" && (
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            )}
            {status === "success" && (
              <CheckCircle2 className="h-6 w-6 text-green-600" />
            )}
            {status === "error" && (
              <AlertCircle className="h-6 w-6 text-destructive" />
            )}

            <div>
              <AlertDialogTitle>{title}</AlertDialogTitle>
              <AlertDialogDescription>
                {status === "running" && `Please wait... ${progress}%`}
                {status === "success" && "Process completed successfully."}
                {status === "error" && (errorMessage || "An error occurred.")}
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        {/* Progress Bar */}
        <div className="mt-4">
          <Progress
            value={progress}
            className={`h-2 ${status === "error" ? "bg-destructive/20" : ""}`}
          />
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};
