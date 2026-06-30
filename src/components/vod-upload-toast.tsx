import { useAtomValue } from "jotai";
import {
  IconBrandTwitch,
  IconBrandYoutube,
  IconCheck,
  IconAlertTriangle,
  IconFolder,
  IconExternalLink,
  IconLoader2,
  IconVideo,
  IconX,
} from "@tabler/icons-react";
import { toast } from "sonner";
import { vodStatusAtom } from "@/store/flowStore";

export const VOD_TOAST_ID = "vod-upload-status";

export function VodUploadToast() {
  const status = useAtomValue(vodStatusAtom);
  if (!status) return null;

  const fileName = status.filePath.split(/[/\\]/).pop() ?? status.filePath;

  const platformTitle = (base: string) =>
    status.platform === "youtube" ? base.replace("VOD", "upload") : base;

  const title: Record<typeof status.phase, string> = {
    recording_saved: "Recording saved",
    searching: status.platform === "youtube" ? "Preparing upload…" : "Waiting for VOD…",
    uploading: "Uploading to YouTube…",
    found: status.platform === "youtube" ? "Upload complete" : "VOD is live",
    not_found: "Recording saved",
    error: platformTitle("VOD tracking failed"),
  };

  const isTerminal = ["found", "not_found", "error"].includes(status.phase);

  return (
    <div className="flex flex-col gap-2 w-full min-w-[280px] max-w-sm">
      {/* Header row */}
      <div className="flex items-center gap-2">
        {status.platform === "twitch" ? (
          <IconBrandTwitch className="size-4 shrink-0" style={{ color: "#9147ff" }} />
        ) : status.platform === "youtube" ? (
          <IconBrandYoutube className="size-4 shrink-0 text-red-500" />
        ) : (
          <IconVideo className="size-4 shrink-0 text-muted-foreground" />
        )}
        <span className="font-medium text-sm flex-1 leading-tight">
          {title[status.phase]}
        </span>
        {status.phase === "found" || status.phase === "not_found" ? (
          <IconCheck className="size-4 shrink-0 text-green-500" />
        ) : status.phase === "error" ? (
          <IconAlertTriangle className="size-4 shrink-0 text-destructive" />
        ) : (
          <IconLoader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
        <button
          onClick={() => toast.dismiss(VOD_TOAST_ID)}
          className="size-4 shrink-0 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Dismiss"
        >
          <IconX className="size-4" />
        </button>
      </div>

      {/* Indeterminate progress bar while polling Twitch VOD */}
      {status.phase === "searching" && (
        <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full w-1/3 bg-primary/60 rounded-full"
            style={{ animation: "vod-indeterminate 1.6s linear infinite" }}
          />
        </div>
      )}

      {/* Determinate progress bar during YouTube upload */}
      {status.phase === "uploading" && (
        <div className="w-full h-1 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-red-500/80 rounded-full transition-all duration-300"
            style={{ width: `${status.progress}%` }}
          />
        </div>
      )}

      {/* Error detail */}
      {status.phase === "error" && (
        <p className="text-xs text-destructive leading-tight line-clamp-2">
          {status.message}
        </p>
      )}

      {/* File name (shown in terminal states) */}
      {isTerminal && (
        <p
          className="text-xs text-muted-foreground truncate"
          title={status.filePath}
        >
          {fileName}
        </p>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => window.electron.openRecordingFolder(status.filePath)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <IconFolder className="size-3" />
          Open folder
        </button>
        {status.phase === "found" && (
          <button
            onClick={() => window.electron.openExternalUrl(status.vodUrl)}
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline transition-colors ml-auto"
          >
            View VOD
            <IconExternalLink className="size-3" />
          </button>
        )}
      </div>
    </div>
  );
}
