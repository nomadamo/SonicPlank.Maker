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
import { Separator } from "@/components/ui/separator";
import { LibraryItem } from "@/types/library-item";
import { useSetAtom } from "jotai";
import { updateLibraryItemAtom } from "@/store/libraryStore";
import {
  FileAudioIcon,
  UserIcon,
  MusicIcon,
  ImageIcon,
  TagsIcon,
  ClockIcon,
} from "lucide-react";
import { IconBrandSpotify } from "@tabler/icons-react";
import { useLibraryStore } from "@/store/libraryStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatTime as formatDuration } from "@/utils/audio";

interface LibraryItemPropertiesDialogProps {
  item: LibraryItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}



export function LibraryItemPropertiesDialog({
  item,
  open,
  onOpenChange,
}: LibraryItemPropertiesDialogProps) {
  const updateLibraryItem = useSetAtom(updateLibraryItemAtom);

  const [title, setTitle] = useState(item?.title ?? "");
  const [artist, setArtist] = useState(item?.artist ?? "");
  const [albumArt, setAlbumArt] = useState(item?.albumArt ?? "");
  const [categoryId, setCategoryId] = useState<string | undefined>(
    item?.categoryId,
  );
  const [filePath, setFilePath] = useState(item?.filePath ?? "");

  const { categories } = useLibraryStore();

  // Reset fields when the target item changes
  useEffect(() => {
    setTitle(item?.title ?? "");
    setArtist(item?.artist ?? "");
    setAlbumArt(item?.albumArt ?? "");
    setCategoryId(item?.categoryId);
    setFilePath(item?.filePath ?? "");
  }, [item]);

  const isSpotify = !!(item?.isSpotifyStream || item?.isSpotifyPlaylist);

  const isStream = !isSpotify && !!(
    item?.isStream ||
    item?.filePath?.startsWith("http://") ||
    item?.filePath?.startsWith("https://")
  );

  const handleSave = useCallback(() => {
    if (!item) return;
    updateLibraryItem({
      id: item.id,
      patch: {
        title,
        artist: isStream ? "" : artist,
        albumArt: albumArt || undefined,
        categoryId: isStream ? undefined : categoryId,
        filePath: isStream ? filePath : item.filePath,
      },
    });
    onOpenChange(false);
  }, [
    item,
    isStream,
    title,
    artist,
    albumArt,
    categoryId,
    filePath,
    updateLibraryItem,
    onOpenChange,
  ]);

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

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: "480px" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {isSpotify ? (
              <IconBrandSpotify className="h-5 w-5 text-green-500" />
            ) : (
              <MusicIcon className="h-5 w-5 text-primary" />
            )}
            Item Properties
          </DialogTitle>
          <DialogDescription>
            {isSpotify
              ? "Spotify track metadata is read-only."
              : "Edit the metadata for this library item."}
          </DialogDescription>
        </DialogHeader>

        <Separator />

        {isSpotify ? (
          /* ── Spotify read-only view ── */
          <div className="flex flex-col gap-4 py-2">
            <div className="flex items-center gap-4">
              <div className="w-20 h-20 rounded-md border bg-muted overflow-hidden shrink-0 flex items-center justify-center">
                {item.albumArt ? (
                  <img
                    src={item.albumArt}
                    alt={item.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <IconBrandSpotify className="h-8 w-8 text-green-500 opacity-60" />
                )}
              </div>
              <div className="flex flex-col gap-1 min-w-0">
                <p className="text-sm font-semibold truncate">{item.title}</p>
                <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                  <UserIcon className="h-3 w-3 shrink-0" />
                  {item.artist || "—"}
                </p>
                {item.duration != null && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <ClockIcon className="h-3 w-3 shrink-0" />
                    {formatDuration(item.duration)}
                  </p>
                )}
                <span className="mt-1 inline-flex items-center gap-1 text-[10px] font-medium text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded-sm w-fit">
                  <IconBrandSpotify className="h-2.5 w-2.5" />
                  Spotify
                </span>
              </div>
            </div>
          </div>
        ) : (
          /* ── Editable view ── */
          <div className="flex flex-col gap-4 py-2">
            {/* Title */}
            <div className="flex flex-col gap-1.5">
              <Label
                htmlFor="lib-prop-title"
                className="flex items-center gap-1.5"
              >
                <MusicIcon className="h-3.5 w-3.5 text-muted-foreground" />
                Title
              </Label>
              <Input
                id="lib-prop-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Track title"
              />
            </div>

            {/* Artist */}
            {!isStream && (
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="lib-prop-artist"
                  className="flex items-center gap-1.5"
                >
                  <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  Artist
                </Label>
                <Input
                  id="lib-prop-artist"
                  value={artist}
                  onChange={(e) => setArtist(e.target.value)}
                  placeholder="Artist name"
                />
              </div>
            )}

            {/* Category */}
            {!isStream && (
              <div className="flex flex-col gap-1.5">
                <Label className="flex items-center gap-1.5">
                  <TagsIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  Category
                </Label>
                <Select
                  value={categoryId || "unassigned"}
                  itemToStringLabel={(val) =>
                    categories.map((c) => (c.id == val ? c.name : ""))
                  }
                  onValueChange={(val) =>
                    setCategoryId(val === "unassigned" ? undefined : val)
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Stream URL */}
            {isStream && (
              <div className="flex flex-col gap-1.5">
                <Label
                  htmlFor="lib-prop-url"
                  className="flex items-center gap-1.5"
                >
                  <FileAudioIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  Stream URL
                </Label>
                <Input
                  id="lib-prop-url"
                  value={filePath}
                  onChange={(e) => setFilePath(e.target.value)}
                  placeholder="Stream URL (http:// or https://)"
                />
              </div>
            )}

            {/* Album Art */}
            <div className="flex flex-col gap-1.5">
              <Label className="flex items-center gap-1.5">
                <ImageIcon className="h-3.5 w-3.5 text-muted-foreground" />
                {isStream ? "Image" : "Album Art"}
              </Label>
              <div className="flex items-center gap-4 mt-1">
                <div
                  className="w-20 h-20 rounded-md border flex items-center justify-center bg-muted overflow-hidden cursor-pointer hover:opacity-80 transition-opacity"
                  onClick={() =>
                    document.getElementById("album-art-upload")?.click()
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
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      document.getElementById("album-art-upload")?.click()
                    }
                  >
                    Change Image
                  </Button>
                  {albumArt && (
                    <Button
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
                  id="album-art-upload"
                  accept="image/*"
                  className="hidden"
                  onChange={handleImageUpload}
                />
              </div>
            </div>

            <Separator />

            {/* Read-only metadata */}
            {!isStream && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  File Info
                </p>
                <div className="flex items-start gap-2">
                  <FileAudioIcon className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                  <p
                    className="text-xs text-muted-foreground break-all"
                    title={item.filePath}
                  >
                    {item.filePath || "—"}
                  </p>
                </div>
                {item.duration != null && (
                  <p className="text-xs text-muted-foreground">
                    Duration: {formatDuration(item.duration)}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2">
          {isSpotify ? (
            <Button onClick={() => onOpenChange(false)}>Close</Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handleSave}>Save Changes</Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
