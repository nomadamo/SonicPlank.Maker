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

interface TimelineHistory {
  past: TimelineData[];
  present: TimelineData;
  future: TimelineData[];
}

const timelineHistoryAtom = atom<TimelineHistory>({
  past: [],
  present: defaultTimelineData,
  future: [],
});

export const timelineDataAtom = atom(
  (get) => get(timelineHistoryAtom).present,
  (get, set, update: TimelineData | ((prev: TimelineData) => TimelineData)) => {
    const history = get(timelineHistoryAtom);
    const nextState = typeof update === "function" ? update(history.present) : update;

    // Prevent pushing identical state to history
    if (history.present === nextState) return;

    set(timelineHistoryAtom, {
      past: [...history.past, history.present].slice(-50), // keep last 50 states
      present: nextState,
      future: [],
    });
  }
);

export const loadTimelineDataAtom = atom(
  null,
  (_get, set, newData: TimelineData) => {
    set(timelineHistoryAtom, {
      past: [],
      present: newData,
      future: [],
    });
  }
);

export const undoTimelineAtom = atom(null, (get, set) => {
  const history = get(timelineHistoryAtom);
  if (history.past.length === 0) return;

  const previous = history.past[history.past.length - 1];
  const newPast = history.past.slice(0, -1);

  set(timelineHistoryAtom, {
    past: newPast,
    present: previous,
    future: [history.present, ...history.future],
  });
});

export const redoTimelineAtom = atom(null, (get, set) => {
  const history = get(timelineHistoryAtom);
  if (history.future.length === 0) return;

  const next = history.future[0];
  const newFuture = history.future.slice(1);

  set(timelineHistoryAtom, {
    past: [...history.past, history.present],
    present: next,
    future: newFuture,
  });
});

export const canUndoTimelineAtom = atom((get) => get(timelineHistoryAtom).past.length > 0);
export const canRedoTimelineAtom = atom((get) => get(timelineHistoryAtom).future.length > 0);
export const sonicsCurrentPathAtom = atom<string | null>(null);
export const sonicsHasUnsavedChangesAtom = atom<boolean>(false);

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

// UI state
export const timelineZoomAtom = atom<number>(50); // pixels per second
export const timelineSelectionAtom = atom<{ trackId: string; start: number; end: number } | null>(null);
export const timelineSelectedClipIdAtom = atom<string | null>(null);
