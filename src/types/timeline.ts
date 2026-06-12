import { LibraryItem } from "./library-item";

export interface TimelineClip {
  id: string;
  item: LibraryItem;
  startTime: number; // in seconds
  startOffset: number; // in seconds (for trimming from the start of the audio)
  duration: number; // in seconds (the visible duration)
}

export interface TimelineTrack {
  id: string;
  name: string;
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number; // -1 to 1 (left to right)
  clips: TimelineClip[];
}

export interface TimelineData {
  tracks: TimelineTrack[];
}
