import { IconName } from "lucide-react/dynamic";

export type LibraryCategory = {
  id: string;
  name: string;
  icon: IconName | "";
  color: string;
};

export type LibraryItem = {
  id: string;
  title: string;
  artist: string;
  filePath: string;
  albumArt?: string; // base64 data URL
  duration?: number; // seconds
  addedAt: number; // timestamp
  categoryId?: string; // ID of the assigned category
  isStream?: boolean; // indicates an online stream (listen-only)
  isSpotifyStream?: boolean; // indicates an online stream (listen-only)
  isSpotifyPlaylist?: boolean; // indicates an online stream (listen-only)
};

export type LibraryData = {
  items: LibraryItem[];
  categories?: LibraryCategory[];
};
