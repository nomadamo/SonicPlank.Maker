import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useLibraryStore, authenticateSpotify } from "@/store/libraryStore";
import { useSetAtom } from "jotai";
import { MusicIcon, PlusCircleIcon, SearchIcon, ListMusicIcon, UserIcon } from "lucide-react";
import { IconBrandSpotify } from "@tabler/icons-react";
import type { Track, SimplifiedPlaylist, SimplifiedAlbum, Artist } from "@spotify/web-api-ts-sdk";
import type { LibraryItem } from "@/types/library-item";

interface AddFromSpotifyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface SearchResults {
  tracks: Track[];
  albums: SimplifiedAlbum[];
  playlists: SimplifiedPlaylist[];
  artists: Artist[];
}

const EMPTY_RESULTS: SearchResults = { tracks: [], albums: [], playlists: [], artists: [] };

function formatDurationMs(ms: number | undefined | null): string {
  if (!ms) return "--:--";
  const totalSecs = Math.floor(ms / 1000);
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function ResultGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-1 pt-2 pb-0.5">
        {label}
      </p>
      {children}
    </div>
  );
}

export function AddFromSpotifyDialog({ open, onOpenChange }: AddFromSpotifyDialogProps) {
  const { spotify, setItems } = useLibraryStore();
  const connectSpotify = useSetAtom(authenticateSpotify);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults>(EMPTY_RESULTS);
  const [isSearching, setIsSearching] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isAuthenticated = spotify !== null;

  const hasResults =
    searchResults.tracks.length > 0 ||
    searchResults.albums.length > 0 ||
    searchResults.playlists.length > 0 ||
    searchResults.artists.length > 0;

  const handleConnect = useCallback(async () => {
    setIsConnecting(true);
    setConnectError(null);
    try {
      await connectSpotify();
    } catch (err: unknown) {
      setConnectError(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setIsConnecting(false);
    }
  }, [connectSpotify]);

  const handleAddTrack = useCallback(
    (item: Track) => {
      const libraryItem: LibraryItem = {
        id: crypto.randomUUID(),
        title: item.name,
        artist: item.artists.map((a) => a.name).join(", "),
        filePath: item.uri,
        albumArt: item.album.images[0]?.url ?? "",
        duration: item.duration_ms / 1000,
        addedAt: Date.now(),
        isSpotifyStream: true,
      };
      setItems((prev) => [...prev, libraryItem]);
      onOpenChange(false);
    },
    [setItems, onOpenChange],
  );

  const handleAddAlbum = useCallback(
    (item: SimplifiedAlbum) => {
      const libraryItem: LibraryItem = {
        id: crypto.randomUUID(),
        title: item.name,
        artist: item.artists.map((a) => a.name).join(", "),
        filePath: item.uri,
        albumArt: item.images?.[0]?.url ?? "",
        addedAt: Date.now(),
        isSpotifyPlaylist: true,
      };
      setItems((prev) => [...prev, libraryItem]);
      onOpenChange(false);
    },
    [setItems, onOpenChange],
  );

  const handleAddPlaylist = useCallback(
    (item: SimplifiedPlaylist) => {
      const libraryItem: LibraryItem = {
        id: crypto.randomUUID(),
        title: item.name,
        artist: item.owner.display_name ?? "",
        filePath: item.uri,
        albumArt: item.images?.[0]?.url ?? "",
        addedAt: Date.now(),
        isSpotifyPlaylist: true,
      };
      setItems((prev) => [...prev, libraryItem]);
      onOpenChange(false);
    },
    [setItems, onOpenChange],
  );

  const handleAddArtist = useCallback(
    (item: Artist) => {
      const libraryItem: LibraryItem = {
        id: crypto.randomUUID(),
        title: item.name,
        artist: item.genres?.[0] ?? "Artist",
        filePath: item.uri,
        albumArt: item.images?.[0]?.url ?? "",
        addedAt: Date.now(),
        isSpotifyPlaylist: true,
      };
      setItems((prev) => [...prev, libraryItem]);
      onOpenChange(false);
    },
    [setItems, onOpenChange],
  );

  useEffect(() => {
    if (!spotify || !searchQuery.trim()) {
      setSearchResults(EMPTY_RESULTS);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await spotify.search(searchQuery, ["track", "album", "playlist", "artist"], undefined, 8);
        setSearchResults({
          tracks: res.tracks?.items ?? [],
          albums: (res.albums?.items ?? []).filter(Boolean),
          playlists: (res.playlists?.items ?? []).filter(Boolean) as SimplifiedPlaylist[],
          artists: res.artists?.items ?? [],
        });
      } catch (err) {
        console.error("Spotify search error:", err);
        setSearchResults(EMPTY_RESULTS);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, spotify]);

  useEffect(() => {
    if (!open) {
      setSearchQuery("");
      setSearchResults(EMPTY_RESULTS);
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent style={{ maxWidth: "520px", maxHeight: "680px" }}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconBrandSpotify className="h-5 w-5 text-green-500" />
            Add from Spotify
          </DialogTitle>
          <DialogDescription>
            {isAuthenticated
              ? "Search and add tracks, playlists, or artists to your library."
              : "Connect your Spotify account to search and add music to your library."}
          </DialogDescription>
        </DialogHeader>

        <Separator />

        {!isAuthenticated ? (
          <div className="flex flex-col items-center justify-center gap-4 py-8">
            <IconBrandSpotify className="h-12 w-12 text-green-500 opacity-70" />
            <p className="text-sm text-muted-foreground text-center max-w-[280px]">
              Connect your Spotify account to search and add music to your library.
            </p>
            {connectError && (
              <p className="text-xs text-destructive text-center">{connectError}</p>
            )}
            <button
              onClick={handleConnect}
              disabled={isConnecting}
              className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium bg-green-500 text-white hover:bg-green-400 disabled:opacity-50 transition-colors"
              style={{ border: "none", cursor: isConnecting ? "default" : "pointer" }}
            >
              <IconBrandSpotify className="h-4 w-4" />
              {isConnecting ? "Connecting…" : "Connect Spotify"}
            </button>
          </div>
        ) : (
          <>
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <input
                type="text"
                placeholder="Search tracks, playlists, artists…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-md bg-muted pl-9 pr-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
                autoFocus
              />
            </div>

            <div
              style={{
                overflowY: "auto",
                maxHeight: "420px",
                display: "flex",
                flexDirection: "column",
                paddingRight: "4px",
              }}
            >
              {isSearching ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                  Searching…
                </div>
              ) : !hasResults && searchQuery.trim() ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
                  No results for &ldquo;{searchQuery}&rdquo;
                </div>
              ) : !hasResults ? (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm gap-2">
                  <MusicIcon className="h-8 w-8 opacity-30" />
                  <span>Start typing to search Spotify</span>
                </div>
              ) : (
                <AnimatePresence>
                  {searchResults.tracks.length > 0 && (
                    <ResultGroup label="Tracks">
                      {searchResults.tracks.map((item, index) => (
                        <motion.button
                          key={item.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ delay: index * 0.02, duration: 0.12 }}
                          onClick={() => handleAddTrack(item)}
                          className="flex items-center gap-3 rounded-lg px-3 py-2 text-left w-full transition-colors hover:bg-accent hover:text-accent-foreground group"
                          style={{ border: "none", background: "none", cursor: "pointer" }}
                        >
                          <div className="h-9 w-9 rounded bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                            {item.album.images[0]?.url ? (
                              <img src={item.album.images[0].url} alt={item.album.name} className="w-full h-full object-cover" />
                            ) : (
                              <MusicIcon className="text-muted-foreground opacity-50" size={16} strokeWidth={1.5} />
                            )}
                          </div>
                          <div className="flex flex-col flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {item.artists[0]?.name}
                              {item.duration_ms ? ` · ${formatDurationMs(item.duration_ms)}` : ""}
                            </p>
                          </div>
                          <PlusCircleIcon className="h-4 w-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </motion.button>
                      ))}
                    </ResultGroup>
                  )}

                  {searchResults.albums.length > 0 && (
                    <ResultGroup label="Albums">
                      {searchResults.albums.map((item, index) => (
                        <motion.button
                          key={item.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ delay: index * 0.02, duration: 0.12 }}
                          onClick={() => handleAddAlbum(item)}
                          className="flex items-center gap-3 rounded-lg px-3 py-2 text-left w-full transition-colors hover:bg-accent hover:text-accent-foreground group"
                          style={{ border: "none", background: "none", cursor: "pointer" }}
                        >
                          <div className="h-9 w-9 rounded bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                            {item.images?.[0]?.url ? (
                              <img src={item.images[0].url} alt={item.name} className="w-full h-full object-cover" />
                            ) : (
                              <MusicIcon className="text-muted-foreground opacity-50" size={16} strokeWidth={1.5} />
                            )}
                          </div>
                          <div className="flex flex-col flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {item.artists.map((a) => a.name).join(", ")}
                              {item.release_date ? ` · ${item.release_date.slice(0, 4)}` : ""}
                            </p>
                          </div>
                          <PlusCircleIcon className="h-4 w-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </motion.button>
                      ))}
                    </ResultGroup>
                  )}

                  {searchResults.playlists.length > 0 && (
                    <ResultGroup label="Playlists">
                      {searchResults.playlists.map((item, index) => (
                        <motion.button
                          key={item.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ delay: index * 0.02, duration: 0.12 }}
                          onClick={() => handleAddPlaylist(item)}
                          className="flex items-center gap-3 rounded-lg px-3 py-2 text-left w-full transition-colors hover:bg-accent hover:text-accent-foreground group"
                          style={{ border: "none", background: "none", cursor: "pointer" }}
                        >
                          <div className="h-9 w-9 rounded bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                            {item.images?.[0]?.url ? (
                              <img src={item.images[0].url} alt={item.name} className="w-full h-full object-cover" />
                            ) : (
                              <ListMusicIcon className="text-muted-foreground opacity-50" size={16} strokeWidth={1.5} />
                            )}
                          </div>
                          <div className="flex flex-col flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {item.owner.display_name}
                              {item.tracks?.total ? ` · ${item.tracks.total} tracks` : ""}
                            </p>
                          </div>
                          <PlusCircleIcon className="h-4 w-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </motion.button>
                      ))}
                    </ResultGroup>
                  )}

                  {searchResults.artists.length > 0 && (
                    <ResultGroup label="Artists">
                      {searchResults.artists.map((item, index) => (
                        <motion.button
                          key={item.id}
                          initial={{ opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0 }}
                          transition={{ delay: index * 0.02, duration: 0.12 }}
                          onClick={() => handleAddArtist(item)}
                          className="flex items-center gap-3 rounded-lg px-3 py-2 text-left w-full transition-colors hover:bg-accent hover:text-accent-foreground group"
                          style={{ border: "none", background: "none", cursor: "pointer" }}
                        >
                          <div className="h-9 w-9 rounded-full bg-muted flex items-center justify-center shrink-0 overflow-hidden">
                            {item.images?.[0]?.url ? (
                              <img src={item.images[0].url} alt={item.name} className="w-full h-full object-cover" />
                            ) : (
                              <UserIcon className="text-muted-foreground opacity-50" size={16} strokeWidth={1.5} />
                            )}
                          </div>
                          <div className="flex flex-col flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{item.name}</p>
                            <p className="text-xs text-muted-foreground truncate">
                              {item.genres?.[0] ?? "Artist"}
                              {item.followers?.total
                                ? ` · ${item.followers.total.toLocaleString()} followers`
                                : ""}
                            </p>
                          </div>
                          <PlusCircleIcon className="h-4 w-4 text-muted-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </motion.button>
                      ))}
                    </ResultGroup>
                  )}
                </AnimatePresence>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
