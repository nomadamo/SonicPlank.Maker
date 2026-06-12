import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
} from "react";
import WaveSurfer, { WaveSurferOptions } from "wavesurfer.js";
import { useSettings } from "./settingsStore";

interface WaveSurferContextType {
  initInstance: (
    id: string,
    container: HTMLDivElement | null,
    options: WaveSurferOptions,
  ) => WaveSurfer;
  getInstance: (id: string) => WaveSurfer | undefined;
  destroyInstance: (id: string) => void;
}

const WaveSurferContext = createContext<WaveSurferContextType | null>(null);

export const WaveSurferProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  // Use a map ref to store instances without triggering unnecessary re-renders
  const instancesRef = useRef<Map<string, WaveSurfer>>(new Map());
  const { settings } = useSettings();

  // Update existing instances when the output device changes
  useEffect(() => {
    if (settings.audioOutputDeviceId !== undefined) {
      instancesRef.current.forEach((ws) => {
        // Only call setSinkId if it is available (v7+)
        if (typeof ws.setSinkId === "function") {
          ws.setSinkId(settings.audioOutputDeviceId || "").catch((err) =>
            console.error(
              "Failed to set audio sink on existing instance:",
              err,
            ),
          );
        }
      });
    }
  }, [settings.audioOutputDeviceId]);

  const audioOutputDeviceId = settings.audioOutputDeviceId;

  const initInstance = useCallback(
    (
      id: string,
      container: HTMLDivElement | null,
      options: WaveSurferOptions,
    ) => {
      if (!container) {
        throw new Error("WaveSurfer container is required");
      }

      if (instancesRef.current.has(id)) {
        instancesRef.current.get(id)?.destroy();
      }

      const ws = WaveSurfer.create({
        ...options,
        container,
      });

      if (audioOutputDeviceId && typeof ws.setSinkId === "function") {
        ws.setSinkId(audioOutputDeviceId).catch((err) =>
          console.error("Failed to set audio sink on new instance:", err),
        );
      }

      instancesRef.current.set(id, ws);
      return ws;
    },
    [audioOutputDeviceId],
  );

  const getInstance = useCallback((id: string) => {
    return instancesRef.current.get(id);
  }, []);

  const destroyInstance = useCallback((id: string) => {
    const ws = instancesRef.current.get(id);
    if (ws) {
      ws.destroy();
      instancesRef.current.delete(id);
    }
  }, []);

  const contextValue = React.useMemo(
    () => ({
      initInstance,
      getInstance,
      destroyInstance,
    }),
    [initInstance, getInstance, destroyInstance],
  );

  return (
    <WaveSurferContext.Provider value={contextValue}>
      {children}
    </WaveSurferContext.Provider>
  );
};

export const useWaveSurferContext = () => {
  const context = useContext(WaveSurferContext);
  if (!context) {
    throw new Error(
      "useWaveSurferContext must be used within a WaveSurferProvider",
    );
  }
  return context;
};
