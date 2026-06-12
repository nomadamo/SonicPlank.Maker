import { atom } from "jotai";
import { TimelineData, TimelineTrack, TimelineClip } from "@/types/timeline";

export const defaultTimelineData: TimelineData = {
  tracks: [
    {
      id: crypto.randomUUID(),
      name: "Track 1",
      muted: false,
      solo: false,
      volume: 1,
      pan: 0,
      clips: [],
    },
  ],
};

export const timelineDataAtom = atom<TimelineData>(defaultTimelineData);

export const timelineTracksAtom = atom(
  (get) => get(timelineDataAtom).tracks,
  (get, set, update: TimelineTrack[] | ((prev: TimelineTrack[]) => TimelineTrack[])) => {
    const currentState = get(timelineDataAtom);
    const nextTracks = typeof update === "function" ? update(currentState.tracks) : update;
    set(timelineDataAtom, { ...currentState, tracks: nextTracks });
  }
);

// Playback state
export const timelineIsPlayingAtom = atom<boolean>(false);
export const timelineCurrentTimeAtom = atom<number>(0);
