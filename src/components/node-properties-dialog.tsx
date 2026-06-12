import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import { FlowNodeType } from "@/types/flow-node";
import { useSetAtom } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import { FileAudioIcon, UserIcon, MusicIcon, Volume2Icon } from "lucide-react";

interface NodePropertiesDialogProps {
  node: FlowNodeType | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatDuration(seconds: number | undefined | null): string {
  if (!seconds) return "--:--";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function NodePropertiesDialog({
  node,
  open,
  onOpenChange,
}: NodePropertiesDialogProps) {
  const updateNodeData = useSetAtom(updateNodeDataAtom);

  const [title, setTitle] = useState(node?.data?.title ?? "");
  const [artist, setArtist] = useState(node?.data?.artist ?? "");
  const [volume, setVolume] = useState(node?.data?.volume ?? 1);

  // Reset fields when the target node changes
  useEffect(() => {
    setTitle(node?.data?.title ?? "");
    setArtist(node?.data?.artist ?? "");
    setVolume(node?.data?.volume ?? 1);
  }, [node]);

  const handleSave = useCallback(() => {
    if (!node) return;
    updateNodeData({ id: node.id, patch: { title, artist, volume } });
    onOpenChange(false);
  }, [node, title, artist, volume, updateNodeData, onOpenChange]);

  if (!node) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: "480px" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MusicIcon className="h-5 w-5 text-primary" />
            Node Properties
          </DialogTitle>
          <DialogDescription>
            Edit the metadata for this audio node.
          </DialogDescription>
        </DialogHeader>

        <Separator />

        <div className="flex flex-col gap-4 py-2">
          {/* Title */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prop-title" className="flex items-center gap-1.5">
              <MusicIcon className="h-3.5 w-3.5 text-muted-foreground" />
              Title
            </Label>
            <Input
              id="prop-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Track title"
            />
          </div>

          {/* Artist */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prop-artist" className="flex items-center gap-1.5">
              <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
              Artist
            </Label>
            <Input
              id="prop-artist"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="Artist name"
            />
          </div>

          {/* Volume */}
          <div className="flex flex-col gap-1.5">
            <Label className="flex items-center gap-1.5">
              <Volume2Icon className="h-3.5 w-3.5 text-muted-foreground" />
              Default Volume — {Math.round(volume * 100)}%
            </Label>
            <Slider
              id="prop-volume"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onValueChange={(v) => setVolume(v as number)}
            />
          </div>

          <Separator />

          {/* Read-only metadata */}
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              File Info
            </p>
            <div className="flex items-start gap-2">
              <FileAudioIcon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
              <p
                className="text-xs text-muted-foreground break-all"
                title={node.data.mediaPath}
              >
                {node.data.mediaPath || "—"}
              </p>
            </div>
            {node.data.duration != null && (
              <p className="text-xs text-muted-foreground">
                Duration: {formatDuration(node.data.duration)}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save Changes</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
