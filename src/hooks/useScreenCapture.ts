import { useState, useCallback, useEffect, useRef } from "react";
import type { ScreenCaptureSource } from "../global";

export interface UseScreenCaptureResult {
  sources: ScreenCaptureSource[];
  activeSource: ScreenCaptureSource | null;
  stream: MediaStream | null;
  loading: boolean;
  error: string | null;
  refreshSources: (options?: any) => Promise<ScreenCaptureSource[]>;
  startCapture: (
    sourceId: string,
    captureAudio?: boolean,
    resolutionOverride?: { maxWidth?: number; maxHeight?: number }
  ) => Promise<MediaStream | null>;
  stopCapture: () => void;
}

export function useScreenCapture(): UseScreenCaptureResult {
  const [sources, setSources] = useState<ScreenCaptureSource[]>([]);
  const [activeSource, setActiveSource] = useState<ScreenCaptureSource | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  
  const streamRef = useRef<MediaStream | null>(null);

  // Refresh available displays and windows
  const refreshSources = useCallback(async (options?: any) => {
    setLoading(true);
    setError(null);
    try {
      const screenSources = await window.electron.getScreenSources(options);
      setSources(screenSources);
      return screenSources;
    } catch (err: any) {
      const errMsg = err?.message || "Failed to retrieve screen capture sources";
      setError(errMsg);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);

  // Stop current active capturing session
  const stopCapture = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        track.stop();
        console.log(`[useScreenCapture] Stopped track: ${track.kind} (${track.label})`);
      });
      streamRef.current = null;
      setStream(null);
    }
    setActiveSource(null);
  }, []);

  // Start capture for a specific source ID
  const startCapture = useCallback(
    async (
      sourceId: string,
      captureAudio = false,
      resolutionOverride?: { maxWidth?: number; maxHeight?: number }
    ): Promise<MediaStream | null> => {
      setLoading(true);
      setError(null);

      // Stop any existing stream first
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }

      try {
        // Construct standard Electron desktop capture constraints
        const maxWidth = resolutionOverride?.maxWidth ?? 3840;
        const maxHeight = resolutionOverride?.maxHeight ?? 2160;

        const videoConstraints: any = {
          mandatory: {
            chromeMediaSource: "desktop",
            chromeMediaSourceId: sourceId,
            minWidth: 320,
            maxWidth: maxWidth,
            minHeight: 180,
            maxHeight: maxHeight,
          },
        };

        const audioConstraints: any = captureAudio
          ? {
              mandatory: {
                chromeMediaSource: "desktop",
                chromeMediaSourceId: sourceId,
              },
            }
          : false;

        const constraints = {
          audio: audioConstraints,
          video: videoConstraints,
        };

        console.log("[useScreenCapture] Requesting media stream with constraints:", constraints);
        
        // Request the stream from Chromium media engine
        const mediaStream = await navigator.mediaDevices.getUserMedia(
          constraints as unknown as MediaStreamConstraints
        );

        streamRef.current = mediaStream;
        setStream(mediaStream);

        // Track when tracks end unexpectedly (e.g. source window closed, or screen disconnected)
        mediaStream.getVideoTracks().forEach((track) => {
          track.onended = () => {
            console.log("[useScreenCapture] Video track ended by system/user.");
            stopCapture();
          };
        });

        // Find and set the active source details
        const selected = sources.find((s) => s.id === sourceId);
        if (selected) {
          setActiveSource(selected);
        } else {
          setActiveSource({
            id: sourceId,
            name: "Captured Screen/Window",
            thumbnailUrl: "",
            appIconUrl: null,
          });
        }

        return mediaStream;
      } catch (err: any) {
        const errMsg = err?.message || "Failed to start screen capture session";
        setError(errMsg);
        setActiveSource(null);
        setStream(null);
        return null;
      } finally {
        setLoading(false);
      }
    },
    [sources, stopCapture]
  );

  // Auto clean-up when component unmounts
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  return {
    sources,
    activeSource,
    stream,
    loading,
    error,
    refreshSources,
    startCapture,
    stopCapture,
  };
}
