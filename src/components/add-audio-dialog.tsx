import * as React from "react";
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { LibraryItem } from "@/types/library-item";
import { ImageIcon, MusicIcon } from "lucide-react";

interface AddAudioDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filePath: string | null;
  onSave: (item: LibraryItem) => void;
}

export function AddAudioDialog({
  open,
  onOpenChange,
  filePath,
  onSave,
}: AddAudioDialogProps) {
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [albumArt, setAlbumArt] = useState("");
  const [duration, setDuration] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && filePath) {
      setLoading(true);
      setError(null);

      const fileName = filePath.split(/[\\/]/).pop() || filePath;
      setTitle(fileName.replace(/\.[^.]+$/, ""));
      setArtist("Unknown Artist");
      setAlbumArt("");
      setDuration(undefined);

      window.electron.getAudioMetadata(filePath)
        .then(async (metadata) => {
          if (metadata.title) setTitle(metadata.title);
          if (metadata.artist) setArtist(metadata.artist);
          if (metadata.albumArt) setAlbumArt(metadata.albumArt);

          let resolvedDuration = metadata.duration;
          if (resolvedDuration !== undefined && resolvedDuration !== null && Number.isFinite(resolvedDuration) && resolvedDuration > 0) {
            setDuration(resolvedDuration);
          } else {
            // Fallback: decode local audio file on the frontend using Web Audio API
            try {
              const normalizedPath = filePath.replace(/\\/g, "/");
              const formattedUrl = normalizedPath.startsWith("http://") || normalizedPath.startsWith("https://")
                ? normalizedPath
                : normalizedPath.startsWith("file:///")
                  ? normalizedPath
                  : "file:///" + normalizedPath;

              if (!formattedUrl.startsWith("http")) {
                const response = await fetch(formattedUrl);
                const arrayBuffer = await response.arrayBuffer();
                const tempCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                try {
                  const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
                  if (audioBuffer && Number.isFinite(audioBuffer.duration) && audioBuffer.duration > 0) {
                    setDuration(audioBuffer.duration);
                  }
                } finally {
                  await tempCtx.close();
                }
              }
            } catch (fallbackErr) {
              console.warn("[AddAudioDialog] Fallback decoding failed:", fallbackErr);
            }
          }
        })
        .catch((err) => {
          console.error("Failed to load metadata in dialog", err);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [open, filePath]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === "string") {
        setAlbumArt(result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const trimmedTitle = title.trim();
    const trimmedArtist = artist.trim();

    if (!trimmedTitle) {
      setError("Please enter a title.");
      return;
    }

    if (!filePath) return;

    const newItem: LibraryItem = {
      id: crypto.randomUUID(),
      title: trimmedTitle,
      artist: trimmedArtist || "Unknown Artist",
      filePath,
      albumArt: albumArt || undefined,
      duration,
      addedAt: Date.now(),
    };

    onSave(newItem);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: "480px" }}>
        <DialogHeader>
          <DialogTitle>Add Audio File</DialogTitle>
          <DialogDescription>
            Configure metadata and album art before importing this file.
          </DialogDescription>
        </DialogHeader>
        <Separator />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="audio-file-path" className="text-xs text-muted-foreground">
              Source File
            </Label>
            <div className="text-xs font-mono bg-muted p-2 rounded-md border border-border overflow-x-auto select-all whitespace-pre-wrap break-all max-h-16">
              {filePath || "No file selected"}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="audio-title">Title</Label>
            <Input
              id="audio-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              disabled={loading}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="audio-artist">Artist</Label>
            <Input
              id="audio-artist"
              value={artist}
              onChange={(e) => setArtist(e.target.value)}
              placeholder="Artist"
              disabled={loading}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
              Album Art / Image
            </Label>
            <div className="flex items-center gap-4 mt-1">
              <div
                className="w-20 h-20 rounded-md border flex items-center justify-center bg-muted overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() =>
                  document.getElementById("audio-art-upload")?.click()
                }
              >
                {albumArt ? (
                  <img
                    src={albumArt}
                    alt="Album Art"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <MusicIcon
                    className="text-muted-foreground opacity-40"
                    size={24}
                  />
                )}
              </div>
              <div className="flex flex-col gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    document.getElementById("audio-art-upload")?.click()
                  }
                  disabled={loading}
                >
                  Choose Image
                </Button>
                {albumArt && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground h-8"
                    onClick={() => setAlbumArt("")}
                    disabled={loading}
                  >
                    Remove
                  </Button>
                )}
              </div>
              <input
                type="file"
                id="audio-art-upload"
                accept="image/*"
                className="hidden"
                onChange={handleImageUpload}
              />
            </div>
          </div>

          {error && (
            <p className="text-xs font-medium text-destructive mt-1">{error}</p>
          )}

          <DialogFooter className="mt-4 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              className="rounded-xl"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="rounded-xl bg-primary text-primary-foreground font-semibold min-w-[70px]"
            >
              {loading ? "Reading..." : "Open"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
