import React, { createContext, useContext, useRef } from "react";
import WaveSurfer, { WaveSurferOptions } from "wavesurfer.js";

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

  const initInstance = (
    id: string,
    container: HTMLDivElement | null,
    options: WaveSurferOptions,
  ) => {
    if (!container) {
      throw new Error("WaveSurfer container is required");
    }

    // Destroy existing instance with the same ID if it exists
    if (instancesRef.current.has(id)) {
      instancesRef.current.get(id)?.destroy();
    }

    const ws = WaveSurfer.create({
      ...options,
      container,
    });

    instancesRef.current.set(id, ws);
    return ws;
  };

  const getInstance = (id: string) => {
    return instancesRef.current.get(id);
  };

  const destroyInstance = (id: string) => {
    const ws = instancesRef.current.get(id);
    if (ws) {
      ws.destroy();
      instancesRef.current.delete(id);
    }
  };

  return (
    <WaveSurferContext.Provider
      value={{ initInstance, getInstance, destroyInstance }}
    >
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
