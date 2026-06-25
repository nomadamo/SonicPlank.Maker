import { useState, useRef, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";
import { useAtomValue, useSetAtom } from "jotai";
import { spotifyTokenAtom, lastDeviceIdAtom, type SpotifyDevice } from "@/store/libraryStore";
import { LibraryItem } from "@/types/library-item";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  PlayIcon,
  PauseIcon,
  ShuffleIcon,
  SkipBackIcon,
  SkipForwardIcon,
  Repeat1Icon,
  CastIcon,
  MonitorIcon,
  SmartphoneIcon,
  SpeakerIcon,
  TvIcon,
  CheckIcon,
  XIcon,
} from "lucide-react";
import { IconBrandSpotify } from "@tabler/icons-react";
import { AudioPlayer, AudioPlayerControlBar } from "@/components/audio/player";
import { formatTime as formatDuration } from "@/utils/audio";

// ── Spotify Connect REST helpers ──────────────────────────────────────────────

interface ConnectState {
  is_playing: boolean;
  progress_ms: number;
  device?: { id: string };
  item: {
    uri: string;
    duration_ms: number;
    name: string;
    artists: { name: string }[];
    album: { images: { url: string }[] };
  } | null;
}

const spotifyHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

function appendDevice(url: string, deviceId?: string | null) {
  if (!deviceId) return url;
  return url + (url.includes("?") ? "&" : "?") + `device_id=${deviceId}`;
}

async function connectPlay(uri: string, token: string, isPlaylist: boolean, positionMs?: number, deviceId?: string | null) {
  const body: any = isPlaylist ? { context_uri: uri } : { uris: [uri] };
  if (positionMs !== undefined) body.position_ms = Math.round(positionMs);
  const res = await fetch(appendDevice("https://api.spotify.com/v1/me/player/play", deviceId), {
    method: "PUT",
    headers: spotifyHeaders(token),
    body: JSON.stringify(body),
  });
  if (!res.ok && res.status !== 204) {
    const json = await res.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(json.error?.message ?? `HTTP ${res.status}`);
  }
}

async function connectResume(token: string, fallbackUri?: string, isPlaylist?: boolean, positionMs?: number, deviceId?: string | null) {
  const res = await fetch(appendDevice("https://api.spotify.com/v1/me/player/play", deviceId), {
    method: "PUT",
    headers: spotifyHeaders(token),
  });
  if (!res.ok) {
    if (fallbackUri && (res.status === 403 || res.status === 404)) {
      // Context likely lost. Fallback to playing the specific URI with position
      await connectPlay(fallbackUri, token, !!isPlaylist, positionMs, deviceId);
      return;
    }
    throw new Error(`HTTP ${res.status}`);
  }
}

async function connectPause(token: string, deviceId?: string | null) {
  const res = await fetch(appendDevice("https://api.spotify.com/v1/me/player/pause", deviceId), {
    method: "PUT",
    headers: spotifyHeaders(token),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function connectSeek(positionMs: number, token: string, deviceId?: string | null) {
  const res = await fetch(appendDevice(`https://api.spotify.com/v1/me/player/seek?position_ms=${Math.round(positionMs)}`, deviceId), {
    method: "PUT",
    headers: spotifyHeaders(token),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function connectVolume(percent: number, token: string, deviceId?: string | null) {
  const res = await fetch(appendDevice(`https://api.spotify.com/v1/me/player/volume?volume_percent=${Math.round(percent)}`, deviceId), {
    method: "PUT",
    headers: spotifyHeaders(token),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function connectShuffle(state: boolean, token: string, deviceId?: string | null) {
  const res = await fetch(appendDevice(`https://api.spotify.com/v1/me/player/shuffle?state=${String(state)}`, deviceId), {
    method: "PUT",
    headers: spotifyHeaders(token),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function connectPrevious(token: string, deviceId?: string | null) {
  const res = await fetch(appendDevice("https://api.spotify.com/v1/me/player/previous", deviceId), {
    method: "POST",
    headers: spotifyHeaders(token),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function connectNext(token: string, deviceId?: string | null) {
  const res = await fetch(appendDevice("https://api.spotify.com/v1/me/player/next", deviceId), {
    method: "POST",
    headers: spotifyHeaders(token),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function connectRepeat(state: "track" | "context" | "off", token: string, deviceId?: string | null) {
  const res = await fetch(appendDevice(`https://api.spotify.com/v1/me/player/repeat?state=${state}`, deviceId), {
    method: "PUT",
    headers: spotifyHeaders(token),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

async function getConnectState(token: string): Promise<ConnectState | null> {
  const res = await fetch("https://api.spotify.com/v1/me/player", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[SpotifyPlayer] getConnectState HTTP ${res.status}: ${errText}`);
    return null;
  }
  return res.json() as Promise<ConnectState>;
}

async function loadDevices(token: string): Promise<SpotifyDevice[]> {
  const res = await fetch("https://api.spotify.com/v1/me/player/devices", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`[SpotifyPlayer] loadDevices HTTP ${res.status}: ${errText}`);
    return [];
  }
  const data = await res.json() as { devices: SpotifyDevice[] };
  return data.devices ?? [];
}

async function transferPlayback(deviceId: string, play: boolean, token: string) {
  await fetch("https://api.spotify.com/v1/me/player", {
    method: "PUT",
    headers: spotifyHeaders(token),
    body: JSON.stringify({ device_ids: [deviceId], play }),
  });
}

// ── Device icon ───────────────────────────────────────────────────────────────

function DeviceIcon({ type, className }: { type: string; className?: string }) {
  switch (type.toLowerCase()) {
    case "smartphone": return <SmartphoneIcon className={className} />;
    case "computer":   return <MonitorIcon className={className} />;
    case "tv":         return <TvIcon className={className} />;
    default:           return <SpeakerIcon className={className} />;
  }
}

// ─────────────────────────────────────────────────────────────────────────────

interface SpotifyLibraryPlayerProps {
  item: LibraryItem;
  onStop: () => void;
  /** When false, skip the initial connectPlay call (item is already playing). */
  autoPlay?: boolean;
}

export function SpotifyLibraryPlayer({
  item,
  onStop,
  autoPlay = true,
}: SpotifyLibraryPlayerProps) {
  const token = useAtomValue(spotifyTokenAtom);
  const tokenRef = useRef(token);
  useEffect(() => { tokenRef.current = token; }, [token]);

  const lastDeviceId = useAtomValue(lastDeviceIdAtom);
  const lastDeviceIdRef = useRef(lastDeviceId);
  useEffect(() => { lastDeviceIdRef.current = lastDeviceId; }, [lastDeviceId]);

  const setLastDeviceId = useSetAtom(lastDeviceIdAtom);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isReady, setIsReady] = useState(!autoPlay);
  const [shuffle, setShuffle] = useState(false);
  const [repeat, setRepeat] = useState(false);
  const [currentTitle, setCurrentTitle] = useState(item.title);
  const [currentArtist, setCurrentArtist] = useState(item.artist ?? "");
  const [albumArtHistory, setAlbumArtHistory] = useState<string[]>(
    item.albumArt ? [item.albumArt] : [],
  );
  const [bgIndex, setBgIndex] = useState(0);
  const lastArtUrlRef = useRef(item.albumArt ?? "");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(item.duration ?? 0);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<SpotifyDevice[]>([]);
  const [loadingDevices, setLoadingDevices] = useState(false);

  const onStopRef = useRef(onStop);
  useEffect(() => { onStopRef.current = onStop; });

  const hasPlayedRef = useRef(false);
  const isSeekingRef = useRef(false);

  // ── Poll / playback effect ────────────────────────────────────────────────

  useEffect(() => {
    if (!token || !item.filePath) return;
    let cancelled = false;
    let pollId: ReturnType<typeof setInterval> | null = null;
    let startId: ReturnType<typeof setTimeout> | null = null;

    const startPolling = (delay: number) => {
      startId = setTimeout(() => {
        if (cancelled) return;
        pollId = setInterval(() => {
          void (async () => {
            if (cancelled) return;
            const t = tokenRef.current;
            if (!t) return;
            const state = await getConnectState(t).catch(() => null);
            if (!state || cancelled) return;

            const playing = state.is_playing;
            if (!isSeekingRef.current) setCurrentTime(state.progress_ms / 1000);
            if (state.item && state.item.duration_ms > 0) setDuration(state.item.duration_ms / 1000);
            setIsPlaying(playing);

            if (state.item) {
              setCurrentTitle(state.item.name);
              setCurrentArtist(state.item.artists.map((a) => a.name).join(", "));
              const newArtUrl = state.item.album.images[0]?.url ?? "";
              if (newArtUrl && newArtUrl !== lastArtUrlRef.current) {
                lastArtUrlRef.current = newArtUrl;
                setAlbumArtHistory((prev) =>
                  [newArtUrl, ...prev.filter((u) => u !== newArtUrl)].slice(0, 6),
                );
                setBgIndex(0);
              }
            }

            if (state.device?.id) {
              setDevices((prev) =>
                prev.map((d) => ({ ...d, is_active: d.id === state.device!.id })),
              );
            }

            if (playing) hasPlayedRef.current = true;
            if (hasPlayedRef.current && !playing && !state.item) onStopRef.current();
            if (
              hasPlayedRef.current &&
              !item.isSpotifyPlaylist &&
              state.item &&
              state.item.uri !== item.filePath
            ) {
              onStopRef.current();
            }
          })();
        }, 1000);
      }, delay);
    };

    const initPlayer = async () => {
      try {
        const devs = await loadDevices(token);
        if (cancelled) return;
        setDevices(devs);
        
        const active = devs.find((d) => d.is_active);
        if (!active && lastDeviceIdRef.current) {
          const target = devs.find((d) => d.id === lastDeviceIdRef.current);
          if (target) {
            await transferPlayback(target.id, false, token);
            if (cancelled) return;
            setDevices((prev) => prev.map((d) => ({ ...d, is_active: d.id === target.id })));
          }
        }
      } catch (err) {
        console.error("[SpotifyPlayer] init device check failed:", err);
      }

      if (autoPlay) {
        try {
          await connectPlay(item.filePath, token, !!item.isSpotifyPlaylist);
          if (cancelled) return;
          setIsReady(true);
          startPolling(1500);
        } catch (err: unknown) {
          if (!cancelled) {
            const msg = err instanceof Error ? err.message : "Playback failed";
            setError(msg);
            console.error("[SpotifyPlayer]", msg);
            startPolling(1500);
          }
        }
      } else {
        startPolling(500);
      }
    };

    initPlayer();

    return () => {
      cancelled = true;
      if (startId) clearTimeout(startId);
      if (pollId) clearInterval(pollId);
    };
  }, [token, item.filePath, autoPlay]);

  // ── Sync effects ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!isReady || !token) return;
    connectShuffle(shuffle, token, lastDeviceIdRef.current).catch(
      (err) => console.error("[SpotifyPlayer] shuffle failed:", err),
    );
  }, [shuffle, isReady, token]);

  useEffect(() => {
    if (!isReady || !token) return;
    connectRepeat(repeat ? "track" : "off", token, lastDeviceIdRef.current).catch(
      (err) => console.error("[SpotifyPlayer] repeat failed:", err),
    );
  }, [repeat, isReady, token]);

  useEffect(() => {
    if (albumArtHistory.length <= 1) return;
    const id = setInterval(() => {
      setBgIndex((i) => (i + 1) % albumArtHistory.length);
    }, 8000);
    return () => clearInterval(id);
  }, [albumArtHistory]);

  // ── Callbacks ─────────────────────────────────────────────────────────────

  const getDeviceId = () => lastDeviceIdRef.current ?? null;

  const toggle = useCallback(() => {
    const t = tokenRef.current;
    if (!t) return;
    if (isPlaying) {
      connectPause(t, getDeviceId()).catch((err) => console.error("[SpotifyPlayer] pause failed:", err));
    } else {
      connectResume(t, item.filePath, !!item.isSpotifyPlaylist, currentTime * 1000, getDeviceId())
        .catch((err) => console.error("[SpotifyPlayer] resume failed:", err));
    }
  }, [isPlaying, item.filePath, item.isSpotifyPlaylist, currentTime]);

  const previous = useCallback(() => {
    const t = tokenRef.current;
    if (t) connectPrevious(t, getDeviceId()).catch((err) => console.error("[SpotifyPlayer] previous failed:", err));
  }, []);

  const next = useCallback(() => {
    const t = tokenRef.current;
    if (t) connectNext(t, getDeviceId()).catch((err) => console.error("[SpotifyPlayer] next failed:", err));
  }, []);

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    setCurrentTime(t);
    isSeekingRef.current = true;
    const tok = tokenRef.current;
    if (tok) {
      connectSeek(t * 1000, tok, getDeviceId())
        .catch((err) => console.error("[SpotifyPlayer] seek failed:", err))
        .finally(() => { isSeekingRef.current = false; });
    }
  };

  const handleVolume = (e: React.ChangeEvent<HTMLInputElement>) => {
    const tok = tokenRef.current;
    if (tok) {
      connectVolume(parseFloat(e.target.value) * 100, tok, getDeviceId()).catch(
        (err) => console.error("[SpotifyPlayer] volume failed:", err),
      );
    }
  };

  const handleOpenDevicePicker = useCallback(() => {
    const t = tokenRef.current;
    if (!t) return;
    setLoadingDevices(true);
    loadDevices(t)
      .then(setDevices)
      .catch((err) => console.error("[SpotifyPlayer] loadDevices failed:", err))
      .finally(() => setLoadingDevices(false));
  }, []);

  const handleSelectDevice = useCallback((device: SpotifyDevice) => {
    const t = tokenRef.current;
    if (!t) return;
    transferPlayback(device.id, isPlaying, t)
      .then(() => {
        setLastDeviceId(device.id);
        setDevices((prev) => prev.map((d) => ({ ...d, is_active: d.id === device.id })));
      })
      .catch((err) => console.error("[SpotifyPlayer] device transfer failed:", err));
  }, [isPlaying, setLastDeviceId]);

  const remaining = Math.max(0, duration - currentTime);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="relative overflow-hidden">
      {/* Album art background */}
      <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
        {albumArtHistory.map((url, i) => (
          <img
            key={url}
            src={url}
            alt=""
            className={cn(
              "absolute inset-0 w-full h-full object-cover transition-opacity duration-2000",
              i === bgIndex ? "opacity-30" : "opacity-0",
            )}
          />
        ))}
      </div>

      <AudioPlayer
        size="sm"
        className="w-full shadow-none border-none bg-transparent rounded-none"
        style={{ background: "transparent", border: "none", boxShadow: "none" }}
      >
        <AudioPlayerControlBar
          variant="compact"
          className="px-4 py-2 w-full flex items-center justify-between"
        >
          {/* Track info */}
          <div className="flex flex-col gap-0.5 p-3 items-start justify-center w-1/4 min-w-[120px] overflow-hidden">
            <div className="font-bold text-shadow-black text-foreground truncate w-full" title={currentTitle}>
              {currentTitle}
            </div>
            <div className="text-muted-foreground text-shadow-black truncate w-full flex items-center gap-1" title={currentArtist}>
              <IconBrandSpotify className="h-3 w-3 text-green-500 shrink-0" />
              {error ? (
                <span className="text-destructive text-xs truncate">{error}</span>
              ) : (
                currentArtist
              )}
            </div>
          </div>

          {/* Center controls */}
          <div className="flex flex-col items-center justify-center gap-1 flex-1 max-w-2xl px-4">
            <div className="flex items-center gap-2">
              {item.isSpotifyPlaylist && (
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "text-muted-foreground hover:text-foreground h-8 w-8",
                    shuffle && "text-green-500 hover:text-green-400",
                  )}
                  onClick={() => setShuffle((s) => !s)}
                  title={shuffle ? "Shuffle on" : "Shuffle off"}
                >
                  <ShuffleIcon className="h-4 w-4" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground h-8 w-8"
                onClick={previous}
                disabled={!isReady || !!error}
                title="Previous"
              >
                <SkipBackIcon className="h-4 w-4" />
              </Button>
              <Button
                className="h-17 w-17 m-0! p-0! [&_svg]:h-6 bg-secondary border [&_svg]:w-6 rounded-full"
                size="icon-lg"
                variant="ghost"
                onClick={toggle}
                disabled={!isReady || !!error}
              >
                {isPlaying ? <PauseIcon /> : <PlayIcon />}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-foreground h-8 w-8"
                onClick={next}
                disabled={!isReady || !!error}
                title="Next"
              >
                <SkipForwardIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "text-muted-foreground hover:text-foreground h-8 w-8",
                  repeat && "text-green-500 hover:text-green-400",
                )}
                onClick={() => setRepeat((r) => !r)}
                title={repeat ? "Repeat on" : "Repeat off"}
              >
                <Repeat1Icon className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex items-center gap-2 w-full">
              <span className="text-xs tabular-nums text-muted-foreground shrink-0 w-10 text-right">
                {formatDuration(currentTime)}
              </span>
              <input
                type="range"
                min={0}
                max={duration || 1}
                step={0.5}
                value={currentTime}
                onChange={handleSeek}
                className="flex-1 h-1 accent-primary cursor-pointer"
                disabled={!isReady || !!error}
              />
              <span className="text-xs tabular-nums text-muted-foreground shrink-0 w-10">
                -{formatDuration(remaining)}
              </span>
            </div>
          </div>

          {/* Right: device picker + volume */}
          <div className="flex items-center justify-end w-1/4 min-w-[150px] gap-2">
            <Popover>
              <PopoverTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-foreground shrink-0 rounded-full h-8 w-8"
                    onClick={handleOpenDevicePicker}
                    title="Connect to a device"
                  >
                    <CastIcon className="h-4 w-4" />
                  </Button>
                }
              />
              <PopoverContent side="top" align="end" className="w-60 p-2 gap-0">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-2 pb-2">
                  Connect to a device
                </p>
                {loadingDevices ? (
                  <p className="text-xs text-muted-foreground px-2 py-2">Loading…</p>
                ) : devices.length === 0 ? (
                  <p className="text-xs text-muted-foreground px-2 py-2">No devices available</p>
                ) : (
                  devices.map((device) => (
                    <button
                      key={device.id}
                      onClick={() => handleSelectDevice(device)}
                      className={cn(
                        "w-full flex items-center gap-3 px-2 py-2 rounded-xl text-left cursor-pointer transition-colors hover:bg-accent",
                        device.is_active ? "text-green-500" : "text-foreground",
                      )}
                      style={{ border: "none", background: "transparent" }}
                    >
                      <DeviceIcon type={device.type} className="h-4 w-4 shrink-0" />
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-sm font-medium truncate">{device.name}</span>
                        <span className={cn("text-xs truncate", device.is_active ? "text-green-500/70" : "text-muted-foreground")}>
                          {device.type}
                        </span>
                      </div>
                      {device.is_active && <CheckIcon className="h-3 w-3 shrink-0" />}
                    </button>
                  ))
                )}
              </PopoverContent>
            </Popover>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              defaultValue={0.8}
              onChange={handleVolume}
              className="w-20 h-1 accent-primary cursor-pointer"
              disabled={!isReady || !!error}
            />
            <Button
              variant="ghost"
              size="icon"
              className="text-muted-foreground hover:text-foreground shrink-0 rounded-full h-8 w-8 ml-2"
              onClick={onStopRef.current}
              title="Close player"
            >
              <XIcon className="h-4 w-4" />
            </Button>
          </div>
        </AudioPlayerControlBar>
      </AudioPlayer>
    </div>
  );
}
