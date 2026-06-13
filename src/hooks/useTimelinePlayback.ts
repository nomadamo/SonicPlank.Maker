import { useEffect, useRef, useCallback } from "react";
import { useAtomValue, useSetAtom, useAtom } from "jotai";
import {
  timelineIsPlayingAtom,
  timelineCurrentTimeAtom,
  timelineTracksAtom,
} from "@/store/timelineStore";
import { $webAudio } from "@/lib/web-audio";
import {
  getOrCreateTrackNodes,
  cleanupUnusedTrackNodes,
} from "@/lib/trackAudioRegistry";

export function useTimelinePlayback() {
  const [isPlaying, setIsPlaying] = useAtom(timelineIsPlayingAtom);
  const setCurrentTime = useSetAtom(timelineCurrentTimeAtom);
  const tracks = useAtomValue(timelineTracksAtom);

  const audioCache = useRef<Map<string, HTMLAudioElement>>(new Map());
  const sourceCache = useRef<Map<string, MediaElementAudioSourceNode>>(
    new Map(),
  );

  // Cleanup unused audio elements, source nodes, and track nodes when clips or tracks are removed
  useEffect(() => {
    const currentClipIds = new Set(
      tracks.flatMap((t) => t.clips.map((c) => c.id)),
    );

    // Clean up audio elements
    for (const [key, audio] of audioCache.current.entries()) {
      const clipId = key.replace("audio-", "");
      if (!currentClipIds.has(clipId)) {
        audio.pause();
        audio.src = "";
        audioCache.current.delete(key);
      }
    }

    // Clean up source nodes
    for (const [clipId, source] of sourceCache.current.entries()) {
      if (!currentClipIds.has(clipId)) {
        try {
          source.disconnect();
        } catch (e) {}
        sourceCache.current.delete(clipId);
      }
    }

    // Clean up unused track nodes
    const currentTrackIds = new Set(tracks.map((t) => t.id));
    cleanupUnusedTrackNodes(currentTrackIds);
  }, [tracks]);

  const requestRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(0);
  const currentTimeRef = useRef<number>(0);

  // Keep a ref to tracks so syncClips doesn't need to be recreated every time a track property changes
  const tracksRef = useRef(tracks);
  useEffect(() => {
    tracksRef.current = tracks;
  }, [tracks]);

  // Sync logic for a single frame
  const syncClips = useCallback((time: number, forcePause: boolean = false) => {
    const ctx = $webAudio.getContext();

    tracksRef.current.forEach((track) => {
      // Base volume multiplied by mute state
      const trackVolume = track.muted ? 0 : track.volume;
      const trackPan = track.pan ?? 0;

      // Get or create Web Audio nodes for the track
      const nodes = getOrCreateTrackNodes(track.id);
      if (nodes && ctx) {
        // Sync track volume (gain)
        if (nodes.gainNode.gain.value !== trackVolume) {
          nodes.gainNode.gain.value = trackVolume;
        }
        // Sync track pan
        if (nodes.pannerNode.pan.value !== trackPan) {
          nodes.pannerNode.pan.value = trackPan;
        }
      }

      track.clips.forEach((clip) => {
        let audio = audioCache.current.get(`audio-${clip.id}`);
        if (!audio) {
          audio = new Audio("file:///" + clip.item.filePath);
          audioCache.current.set(`audio-${clip.id}`, audio);
        }

        // Route through Web Audio if nodes exist and not panned/gained twice
        let source = sourceCache.current.get(clip.id);
        if (!source && nodes && ctx) {
          try {
            source = ctx.createMediaElementSource(audio);
            source.connect(nodes.gainNode);
            sourceCache.current.set(clip.id, source);
          } catch (err) {
            console.error(
              "Error creating MediaElementSource for clip",
              clip.id,
              err,
            );
          }
        }

        // Ensure volume is synced
        if (source) {
          // If routed through Web Audio, we keep audio element volume at 1.0
          // to let gainNode control it completely
          if (audio.volume !== 1.0) {
            audio.volume = 1.0;
          }
        } else {
          // Fallback if not routed to Web Audio yet
          if (audio.volume !== trackVolume) {
            audio.volume = trackVolume;
          }
        }

        const isInsideClip =
          time >= clip.startTime && time < clip.startTime + clip.duration;
        const expectedInternalTime =
          time - clip.startTime + (clip.startOffset || 0);

        if (isInsideClip && !forcePause) {
          if (audio.paused) {
            audio.play().catch(() => {});
          }
          // Drift correction: if audio is out of sync by more than 250ms, seek it
          if (Math.abs(audio.currentTime - expectedInternalTime) > 0.25) {
            audio.currentTime = expectedInternalTime;
          }
        } else {
          if (!audio.paused) {
            audio.pause();
          }
          // If we are scrubbing while paused, ensure the playhead inside the clip is correct
          if (isInsideClip && forcePause) {
            if (Math.abs(audio.currentTime - expectedInternalTime) > 0.05) {
              audio.currentTime = expectedInternalTime;
            }
          }
        }
      });
    });
  }, []);

  const loop = useCallback(
    (timeNow: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = timeNow;
      const deltaTime = (timeNow - lastTimeRef.current) / 1000;
      lastTimeRef.current = timeNow;

      setCurrentTime((prev) => {
        const nextTime = prev + deltaTime;
        currentTimeRef.current = nextTime;

        // Stop playing if we reach the end of the project
        const maxEndTime = tracksRef.current.reduce((max, track) => {
          const trackMax = track.clips.reduce(
            (tMax, clip) => Math.max(tMax, clip.startTime + clip.duration),
            0,
          );
          return Math.max(max, trackMax);
        }, 0);

        if (nextTime > maxEndTime && maxEndTime > 0) {
          setIsPlaying(false);
          syncClips(maxEndTime, true);
          return maxEndTime;
        }

        syncClips(nextTime, false);
        return nextTime;
      });

      requestRef.current = requestAnimationFrame(loop);
    },
    [setCurrentTime, syncClips, setIsPlaying],
  );

  // Start / Stop Loop
  useEffect(() => {
    if (isPlaying) {
      lastTimeRef.current = performance.now();
      requestRef.current = requestAnimationFrame(loop);
    } else {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
      // When pausing, make sure all clips are paused
      syncClips(currentTimeRef.current, true);
    }

    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [isPlaying, loop, syncClips]);

  const play = useCallback(() => {
    const ctx = $webAudio.getContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume();
    }
    setIsPlaying(true);
  }, [setIsPlaying]);

  const pause = useCallback(() => setIsPlaying(false), [setIsPlaying]);

  const togglePlay = useCallback(() => {
    setIsPlaying((p) => {
      const nextPlay = !p;
      if (nextPlay) {
        const ctx = $webAudio.getContext();
        if (ctx && ctx.state === "suspended") {
          ctx.resume();
        }
      }
      return nextPlay;
    });
  }, [setIsPlaying]);

  const seek = useCallback(
    (time: number) => {
      currentTimeRef.current = time;
      setCurrentTime(time);
      syncClips(time, !isPlaying);
    },
    [setCurrentTime, syncClips, isPlaying],
  );

  return {
    isPlaying,
    currentTime: currentTimeRef.current, // Only initial or last known, not reactive
    play,
    pause,
    togglePlay,
    seek,
  };
}
