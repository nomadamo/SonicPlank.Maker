import { atom, useAtom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import { LibraryItem, LibraryCategory } from "@/types/library-item";
import { SpotifyApi } from "@spotify/web-api-ts-sdk";
import { SPOTIFY_CLIENT_ID } from "@/constants/audio";

export const libraryItemsAtom = atom<LibraryItem[]>([]);
export const libraryCategoriesAtom = atom<LibraryCategory[]>([]);
export const libraryLoadedAtom = atom<boolean>(false);
export const spotifyAtom = atom<SpotifyApi | null>(null);
export const spotifyTokenAtom = atom<string | null>(null);
export const globalPlayingItemIdAtom = atom<string | null>(null);

export const updateLibraryItemAtom = atom(
  null,
  (get, set, { id, patch }: { id: string; patch: Partial<LibraryItem> }) => {
    const items = get(libraryItemsAtom);
    const updated = items.map((item) =>
      item.id === id ? { ...item, ...patch } : item,
    );
    set(libraryItemsAtom, updated);
  },
);

// ── Spotify types ─────────────────────────────────────────────────────────────

interface SpotifyCredentials {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  obtainedAt: number;
}

export interface SpotifyDevice {
  id: string;
  name: string;
  type: string;
  is_active: boolean;
  volume_percent: number | null;
}

export interface CurrentPlayback {
  title: string;
  artist: string;
  albumArt: string;
  uri: string;
  isPlaylist: boolean;
  isPlaying: boolean;
  duration: number;
}

interface StartupPlayerState {
  is_playing: boolean;
  device?: { id: string };
  context?: { type: string; uri: string } | null;
  item: {
    uri: string;
    name: string;
    artists: { name: string }[];
    album: { images: { url: string }[] };
    duration_ms: number;
  } | null;
}

// ── Atoms ─────────────────────────────────────────────────────────────────────

export const spotifyCredentialsAtom = atomWithStorage<SpotifyCredentials | null>(
  "sonicplank-spotify-credentials",
  null,
  createJSONStorage<SpotifyCredentials | null>(),
  { getOnInit: true },
);

export const lastDeviceIdAtom = atomWithStorage<string | null>(
  "sonicplank-last-device",
  null,
  createJSONStorage<string | null>(),
  { getOnInit: true },
);

export const currentPlaybackAtom = atom<CurrentPlayback | null>(null);

export const spotifyNeedsReauthAtom = atom(false);

// Controls whether the full Spotify player bar is visible. Starts false so
// the bar doesn't auto-appear on launch. Set true only when the user
// explicitly opens it via the mini-bar, or a new track starts while the app
// is already running with a known previous track.
export const spotifyPlayerVisibleAtom = atom(false);

export const isGlobalPlayerActiveAtom = atom((get) => {
  const localId = get(globalPlayingItemIdAtom);
  if (localId) return true;
  return get(spotifyPlayerVisibleAtom);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildSdk(creds: SpotifyCredentials): SpotifyApi {
  return SpotifyApi.withAccessToken(SPOTIFY_CLIENT_ID, {
    access_token: creds.accessToken,
    refresh_token: creds.refreshToken,
    expires_in: creds.expiresIn,
    token_type: "Bearer",
  });
}

async function refreshCredentials(refreshToken: string): Promise<SpotifyCredentials> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: SPOTIFY_CLIENT_ID,
  });
  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Spotify token refresh failed: ${res.status} ${errText}`);
  }
  const data = await res.json() as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresIn: data.expires_in,
    obtainedAt: Date.now(),
  };
}

// ── Startup init ──────────────────────────────────────────────────────────────

// Call once at app startup. Restores Spotify auth, silently refreshes if
// expired, then checks for active playback and wakes the last-used device if idle.
export const initSpotifyFromStorage = atom(null, async (get, set) => {
  const creds = get(spotifyCredentialsAtom);
  if (!creds) return;

  const expiresAt = creds.obtainedAt + creds.expiresIn * 1000;
  const isValid = Date.now() < expiresAt - 60_000;

  let accessToken: string;

  if (isValid) {
    set(spotifyAtom, buildSdk(creds));
    set(spotifyTokenAtom, creds.accessToken);
    accessToken = creds.accessToken;
  } else {
    try {
      const refreshed = await refreshCredentials(creds.refreshToken);
      set(spotifyCredentialsAtom, refreshed);
      set(spotifyAtom, buildSdk(refreshed));
      set(spotifyTokenAtom, refreshed.accessToken);
      accessToken = refreshed.accessToken;
    } catch (err) {
      console.warn("[Spotify] Silent refresh failed, clearing credentials:", err);
      set(spotifyCredentialsAtom, null);
      set(spotifyAtom, null);
      set(spotifyTokenAtom, null);
      return;
    }
  }

  // Check current playback state
  try {
    const playerRes = await fetch("https://api.spotify.com/v1/me/player", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (playerRes.status === 200) {
      const state = await playerRes.json() as StartupPlayerState;
      if (state.item) {
        const context = state.context ?? null;
        const uri = context ? context.uri : state.item.uri;
        set(currentPlaybackAtom, {
          title: state.item.name,
          artist: state.item.artists.map((a) => a.name).join(", "),
          albumArt: state.item.album.images[0]?.url ?? "",
          uri,
          isPlaylist: !!context,
          isPlaying: state.is_playing,
          duration: state.item.duration_ms / 1000,
        });
        if (state.device?.id) {
          set(lastDeviceIdAtom, state.device.id);
        }
      }
    } else if (playerRes.status === 204) {
      // Nothing playing — try to wake the last-used device silently
      const savedDeviceId = get(lastDeviceIdAtom);
      if (savedDeviceId) {
        const devicesRes = await fetch("https://api.spotify.com/v1/me/player/devices", {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (devicesRes.ok) {
          const { devices } = await devicesRes.json() as { devices: Array<{ id: string }> };
          if (devices.some((d) => d.id === savedDeviceId)) {
            await fetch("https://api.spotify.com/v1/me/player", {
              method: "PUT",
              headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
              body: JSON.stringify({ device_ids: [savedDeviceId], play: false }),
            }).catch(() => null);
          }
        }
      }
    }
  } catch (err) {
    console.warn("[Spotify] Startup playback check failed:", err);
  }
});

// ── Auth ──────────────────────────────────────────────────────────────────────

export const pollSpotifyPlaybackAtom = atom(null, async (get, set) => {
  let creds = get(spotifyCredentialsAtom);
  if (!creds) return;

  // Proactively refresh if within 60 seconds of expiry
  const expiresAt = creds.obtainedAt + creds.expiresIn * 1000;
  if (Date.now() >= expiresAt - 60_000) {
    try {
      const refreshed = await refreshCredentials(creds.refreshToken);
      set(spotifyCredentialsAtom, refreshed);
      set(spotifyAtom, buildSdk(refreshed));
      set(spotifyTokenAtom, refreshed.accessToken);
      creds = refreshed;
    } catch {
      set(spotifyCredentialsAtom, null);
      set(spotifyAtom, null);
      set(spotifyTokenAtom, null);
      set(spotifyNeedsReauthAtom, true);
      return;
    }
  }

  try {
    const playerRes = await fetch("https://api.spotify.com/v1/me/player", {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });

    if (playerRes.status === 401) {
      // Token rejected; attempt one more refresh before giving up
      try {
        const refreshed = await refreshCredentials(creds.refreshToken);
        set(spotifyCredentialsAtom, refreshed);
        set(spotifyAtom, buildSdk(refreshed));
        set(spotifyTokenAtom, refreshed.accessToken);
      } catch {
        set(spotifyCredentialsAtom, null);
        set(spotifyAtom, null);
        set(spotifyTokenAtom, null);
        set(spotifyNeedsReauthAtom, true);
      }
      return;
    }

    if (playerRes.status === 200) {
      const state = await playerRes.json() as StartupPlayerState;
      if (state.item) {
        const context = state.context ?? null;
        const uri = context ? context.uri : state.item.uri;

        // Only update if it actually changed to avoid re-renders
        const current = get(currentPlaybackAtom);
        if (
          !current ||
          current.uri !== uri ||
          current.isPlaying !== state.is_playing ||
          current.title !== state.item.name
        ) {
          // If a different track just started while we already had playback
          // state, pop the player bar back open (user started something new).
          if (current && current.uri !== uri) {
            set(spotifyPlayerVisibleAtom, true);
          }
          set(currentPlaybackAtom, {
            title: state.item.name,
            artist: state.item.artists.map((a) => a.name).join(", "),
            albumArt: state.item.album.images[0]?.url ?? "",
            uri,
            isPlaylist: !!context,
            isPlaying: state.is_playing,
            duration: state.item.duration_ms / 1000,
          });
        }

        if (state.device?.id) {
          set(lastDeviceIdAtom, state.device.id);
        }
      }
    }
  } catch {
    // Ignore fetch errors during polling
  }
});

export const authenticateSpotify = atom(null, async (_get, set) => {
  const tokens = await window.electron.initiateSpotifyAuth();
  const creds: SpotifyCredentials = {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    obtainedAt: Date.now(),
  };
  set(spotifyCredentialsAtom, creds);
  set(spotifyAtom, buildSdk(creds));
  set(spotifyTokenAtom, tokens.accessToken);
  set(spotifyNeedsReauthAtom, false);
});

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLibraryStore() {
  const [items, setItems] = useAtom(libraryItemsAtom);
  const [spotify, setSpotify] = useAtom(spotifyAtom);
  const [categories, setCategories] = useAtom(libraryCategoriesAtom);
  const [loaded, setLoaded] = useAtom(libraryLoadedAtom);

  return {
    items,
    setItems,
    categories,
    setCategories,
    loaded,
    setLoaded,
    spotify,
    setSpotify,
  };
}
