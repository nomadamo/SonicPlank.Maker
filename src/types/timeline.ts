import { LibraryItem } from "./library-item";

export interface AutomationPoint {
  time: number; // in seconds, relative to the clip start
  value: number; // volume multiplier (0.0 to 1.0+)
  curve?: "linear" | "smooth"; // Type of interpolation between this point and the next
}

export interface TimelineClip {
  id: string;
  item: LibraryItem;
  startTime: number; // in seconds
  startOffset: number; // in seconds (for trimming from the start of the audio)
  duration: number; // in seconds (the visible duration)
  volume?: number; // local clip volume modifier (0 to 1+)
  volumeEnvelope?: AutomationPoint[]; // Array of volume automation points
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
