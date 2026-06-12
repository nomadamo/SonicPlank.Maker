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

interface AddStreamDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (item: LibraryItem) => void;
  initialTitle?: string;
  initialUrl?: string;
}

export function AddStreamDialog({
  open,
  onOpenChange,
  onSave,
  initialTitle = "",
  initialUrl = "",
}: AddStreamDialogProps) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [albumArt, setAlbumArt] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setTitle(initialTitle);
      setUrl(initialUrl);
      setAlbumArt("");
      setError(null);
    }
  }, [open, initialTitle, initialUrl]);

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
    const trimmedUrl = url.trim();

    if (!trimmedTitle) {
      setError("Please enter a title for the stream.");
      return;
    }

    if (!trimmedUrl) {
      setError("Please enter a URL.");
      return;
    }

    // Basic URL validation
    try {
      const parsedUrl = new URL(trimmedUrl);
      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        setError("Only HTTP and HTTPS stream URLs are supported.");
        return;
      }
    } catch (err) {
      setError("Please enter a valid URL (e.g., https://example.com/stream).");
      return;
    }

    const newItem: LibraryItem = {
      id: crypto.randomUUID(),
      title: trimmedTitle,
      artist: "",
      filePath: trimmedUrl,
      isStream: true,
      albumArt: albumArt || undefined,
      addedAt: Date.now(),
    };

    onSave(newItem);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: "480px" }}>
        <DialogHeader>
          <DialogTitle>Add Stream</DialogTitle>
          <DialogDescription>
            Add a live streaming audio URL (e.g. icecast radio station) to your
            library.
          </DialogDescription>
        </DialogHeader>
        <Separator />

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stream-title">Stream Title</Label>
            <Input
              id="stream-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Ambient Space Radio"
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="stream-url">Stream URL</Label>
            <Input
              id="stream-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="e.g. http://stream.ambientradio.org:8000/space"
              type="text"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="flex items-center gap-1.5">
              <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
              Image / Album Art
            </Label>
            <div className="flex items-center gap-4 mt-1">
              <div
                className="w-20 h-20 rounded-md border flex items-center justify-center bg-muted overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() =>
                  document.getElementById("stream-art-upload")?.click()
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
                    document.getElementById("stream-art-upload")?.click()
                  }
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
                  >
                    Remove
                  </Button>
                )}
              </div>
              <input
                type="file"
                id="stream-art-upload"
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
              className="rounded-xl bg-primary text-primary-foreground font-semibold"
            >
              Add Stream
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
