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
import { TimelineClip } from "@/types/timeline";

function getInterpolatedVolume(clip: TimelineClip, localTime: number): number {
  const baseVolume = clip.volume ?? 1.0;
  const env = clip.volumeEnvelope;
  
  if (!env || env.length === 0) return baseVolume;

  // Before first point
  if (localTime <= env[0].time) return env[0].value;
  
  // After last point
  if (localTime >= env[env.length - 1].time) return env[env.length - 1].value;

  // Find surrounding points
  for (let i = 0; i < env.length - 1; i++) {
    const p0 = env[i];
    const p1 = env[i + 1];
    
    if (localTime >= p0.time && localTime <= p1.time) {
      const t = (localTime - p0.time) / (p1.time - p0.time); // 0.0 to 1.0
      
      if (p0.curve === "linear") {
        return p0.value + (p1.value - p0.value) * t;
      } else {
        // Smooth curve (cosine approximation of cubic bezier)
        const smoothT = 0.5 - 0.5 * Math.cos(t * Math.PI);
        return p0.value + (p1.value - p0.value) * smoothT;
      }
    }
  }

  return baseVolume;
}

export function useTimelinePlayback() {
  const [isPlaying, setIsPlaying] = useAtom(timelineIsPlayingAtom);
  const setCurrentTime = useSetAtom(timelineCurrentTimeAtom);
  const tracks = useAtomValue(timelineTracksAtom);

  const audioCache = useRef<Map<string, HTMLAudioElement>>(new Map());
  const sourceCache = useRef<Map<string, { source: MediaElementAudioSourceNode, gainNode: GainNode }>>(
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
    for (const [clipId, nodes] of sourceCache.current.entries()) {
      if (!currentClipIds.has(clipId)) {
        try {
          nodes.source.disconnect();
          nodes.gainNode.disconnect();
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
  const syncClips = useCallback((time: number, forcePause: boolean = false, isSeek: boolean = false) => {
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
        let clipNodes = sourceCache.current.get(clip.id);
        if (!clipNodes && nodes && ctx) {
          try {
            const source = ctx.createMediaElementSource(audio);
            const gainNode = ctx.createGain();
            source.connect(gainNode);
            gainNode.connect(nodes.gainNode);
            clipNodes = { source, gainNode };
            sourceCache.current.set(clip.id, clipNodes);
          } catch (err) {
            console.error(
              "Error creating MediaElementSource for clip",
              clip.id,
              err,
            );
          }
        }

        const isInsideClip =
          time >= clip.startTime && time < clip.startTime + clip.duration;
        const expectedInternalTime =
          time - clip.startTime + (clip.startOffset || 0);

        // Calculate dynamic envelope volume
        const localTime = time - clip.startTime;
        const dynamicVolume = getInterpolatedVolume(clip, localTime);

        // Ensure volume is synced
        if (clipNodes) {
          // If routed through Web Audio, use the clip's specific gain node
          // Note: Since this runs ~60fps in requestAnimationFrame, this creates relatively smooth automation,
          // though using gainNode.gain.setValueAtTime would be better for sample-accurate scheduling.
          // For now, this meets the immediate non-destructive edit requirements visually and audibly.
          if (Math.abs(clipNodes.gainNode.gain.value - dynamicVolume) > 0.001) {
            clipNodes.gainNode.gain.value = dynamicVolume;
          }
        } else {
          // Fallback if not routed to Web Audio yet
          const combinedVolume = trackVolume * dynamicVolume;
          if (Math.abs(audio.volume - combinedVolume) > 0.001) {
            audio.volume = Math.max(0, Math.min(1, combinedVolume));
          }
        }

        if (isInsideClip && !forcePause) {
          if (audio.paused) {
            // Sync playhead tightly BEFORE playing to prevent massive stutter jumps
            if (Math.abs(audio.currentTime - expectedInternalTime) > 0.05) {
              audio.currentTime = expectedInternalTime;
            }
            audio.play().catch(() => {});
          } else {
            // Drift correction: if audio is out of sync, correct it.
            // But if we are naturally playing, we NEVER snap unless it's a catastrophic drift
            // If the user sought (isSeek), we snap tightly.
            if (isSeek && Math.abs(audio.currentTime - expectedInternalTime) > 0.05) {
              audio.currentTime = expectedInternalTime;
            } else if (Math.abs(audio.currentTime - expectedInternalTime) > 5.0) {
              // Only snap during natural playback if it somehow drifts by more than 5 seconds!
              audio.currentTime = expectedInternalTime;
            }
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
      syncClips(time, !isPlaying, true);
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
