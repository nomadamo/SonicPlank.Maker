// "use client";

// import {
//   useState,
//   useEffect,
//   useRef,
//   memo,
//   type ReactElement,
//   type RefObject,
// } from "react";
// import WaveSurfer, {
//   type WaveSurferEvents,
//   type WaveSurferOptions,
// } from "wavesurfer.js";

// type WavesurferEventHandler<T extends unknown[]> = (
//   wavesurfer: WaveSurfer,
//   ...args: T
// ) => void;

// type OnWavesurferEvents = {
//   [K in keyof WaveSurferEvents as `on${Capitalize<K>}`]?: WavesurferEventHandler<
//     WaveSurferEvents[K]
//   >;
// };

// type PartialWavesurferOptions = Omit<WaveSurferOptions, "container">;

// export type WavesurferProps = PartialWavesurferOptions &
//   OnWavesurferEvents & {
//     className?: string;
//   };

// export const WAVESURFER_DEFAULTS = {
//   waveColor: "var(--muted-foreground)",
//   progressColor: "var(--primary)",
//   height: 64,
//   barWidth: 3,
//   barGap: 2,
//   barRadius: 2,
//   minPxPerSec: 1,
//   cursorWidth: 0,
// } as const satisfies Partial<WaveSurferOptions>;

// const EVENT_PROP_RE = /^on([A-Z])/;
// const isEventProp = (key: string) => EVENT_PROP_RE.test(key);
// const getEventName = (key: string) =>
//   key.replace(EVENT_PROP_RE, (_, $1) =>
//     $1.toLowerCase(),
//   ) as keyof WaveSurferEvents;

// // ─── Component ───────────────────────────────────────────────────────────────
// const WavesurferPlayer = memo(
//   (props: WavesurferProps): ReactElement => {
//     const containerRef = useRef<HTMLDivElement | null>(null);
//     const wsRef = useRef<WaveSurfer | null>(null);
//     const { className, ...rest } = props;

//     // ── Separate options from event handlers
//     const options: Partial<WaveSurferOptions> = {};
//     const eventProps: OnWavesurferEvents = {};
//     for (const key in rest) {
//       if (isEventProp(key))
//         eventProps[key as keyof OnWavesurferEvents] = rest[
//           key as keyof typeof rest
//         ] as never;
//       else
//         options[key as keyof PartialWavesurferOptions] = rest[
//           key as keyof typeof rest
//         ] as never;
//     }

//     // ── Resolve CSS vars
//     const waveColor =
//       (options.waveColor as string | undefined) ??
//       WAVESURFER_DEFAULTS.waveColor;
//     const progressColor =
//       (options.progressColor as string | undefined) ??
//       WAVESURFER_DEFAULTS.progressColor;
//     const resolvedWaveColor = useCssVar(waveColor);
//     const resolvedProgressColor = useCssVar(progressColor);

//     // ── Keep event handlers in a ref — changes never cause re-subscription
//     const eventsRef = useRef(eventProps);
//     eventsRef.current = eventProps;

//     // ── Keep non-url options in a ref — changes applied imperatively
//     const optionsRef = useRef(options);
//     optionsRef.current = options;

//     // ── Create instance only when url or structural options change
//     const url = options.url as string | undefined;
//     const height =
//       (options.height as number | undefined) ?? WAVESURFER_DEFAULTS.height;
//     const barWidth =
//       (options.barWidth as number | undefined) ?? WAVESURFER_DEFAULTS.barWidth;
//     const barGap =
//       (options.barGap as number | undefined) ?? WAVESURFER_DEFAULTS.barGap;
//     const barRadius =
//       (options.barRadius as number | undefined) ??
//       WAVESURFER_DEFAULTS.barRadius;
//     const minPxPerSec =
//       (options.minPxPerSec as number | undefined) ??
//       WAVESURFER_DEFAULTS.minPxPerSec;
//     const cursorWidth =
//       (options.cursorWidth as number | undefined) ??
//       WAVESURFER_DEFAULTS.cursorWidth;
//     const dragToSeek = options.dragToSeek as boolean | undefined;
//     const media = options.media as HTMLMediaElement | undefined;

//     useEffect(() => {
//       if (!containerRef.current) return;

//       const ws = WaveSurfer.create({
//         ...WAVESURFER_DEFAULTS,
//         url,
//         height,
//         barWidth,
//         barGap,
//         barRadius,
//         minPxPerSec,
//         cursorWidth,
//         dragToSeek,
//         media,
//         plugins: optionsRef.current.plugins,
//         waveColor: resolvedWaveColor,
//         progressColor: resolvedProgressColor,
//         container: containerRef.current,
//       });

//       wsRef.current = ws;

//       // Subscribe to all events via ref — always calls latest handler
//       const eventEntries = Object.keys(eventsRef.current);
//       const unsubs = eventEntries.map((name) => {
//         const event = getEventName(name);
//         return ws.on(event, (...args) =>
//           (
//             eventsRef.current[
//               name as keyof OnWavesurferEvents
//             ] as WavesurferEventHandler<WaveSurferEvents[typeof event]>
//           )?.(ws, ...args),
//         );
//       });

//       return () => {
//         unsubs.forEach((fn) => fn());
//         ws.destroy();
//         wsRef.current = null;
//       };
//       // Only remount when these primitive options change — NOT handlers, NOT colors
//       // eslint-disable-next-line react-hooks/exhaustive-deps
//     }, [
//       url,
//       height,
//       barWidth,
//       barGap,
//       barRadius,
//       minPxPerSec,
//       cursorWidth,
//       dragToSeek,
//     ]);

//     // ── Apply color changes imperatively — zero remount on theme switch
//     useEffect(() => {
//       wsRef.current?.setOptions({
//         waveColor: resolvedWaveColor,
//         progressColor: resolvedProgressColor,
//       });
//     }, [resolvedWaveColor, resolvedProgressColor]);

//     // ── Skeleton
//     const [isReady, setIsReady] = useState(false);
//     useEffect(() => {
//       const ws = wsRef.current;
//       if (!ws) return;

//       // Sync immediately with current instance — avoids skeleton flash on re-render
//       // when the instance already exists and audio is already decoded
//       setIsReady(ws.getDuration() > 0);

//       const unsubs = [
//         ws.on("ready", () => setIsReady(true)),
//         ws.on("load", () => setIsReady(false)),
//         ws.on("destroy", () => setIsReady(false)),
//       ];
//       return () => unsubs.forEach((fn) => fn());
//       // Re-attach when instance changes (url change creates new instance)
//       // eslint-disable-next-line react-hooks/exhaustive-deps
//     }, [wsRef.current]);

//     return (
//       <div className={className} style={{ position: "relative" }}>
//         {!isReady && (
//           <div
//             style={{
//               height,
//               width: "100%",
//               position: "absolute",
//               inset: 0,
//               borderRadius: 4,
//               background: "hsl(var(--muted))",
//               animation: "pulse 2s cubic-bezier(0.4,0,0.6,1) infinite",
//             }}
//           />
//         )}
//         <div ref={containerRef} style={!isReady ? { opacity: 0 } : undefined} />
//       </div>
//     );
//   },
//   (prev, next) => {
//     // Only remount when structural audio options change — ignore handlers and className
//     const STRUCTURAL_KEYS = [
//       "url",
//       "height",
//       "barWidth",
//       "barGap",
//       "barRadius",
//       "minPxPerSec",
//       "cursorWidth",
//       "dragToSeek",
//       "waveColor",
//       "progressColor",
//     ];
//     return STRUCTURAL_KEYS.every(
//       (k) =>
//         prev[k as keyof WavesurferProps] === next[k as keyof WavesurferProps],
//     );
//   },
// );

// export default WavesurferPlayer;

// // ─── Hook ────────────────────────────────────────────────────────────────────
// export function useWavesurfer({
//   container,
//   waveColor = WAVESURFER_DEFAULTS.waveColor,
//   progressColor = WAVESURFER_DEFAULTS.progressColor,
//   ...options
// }: Omit<WaveSurferOptions, "container"> & {
//   container: RefObject<HTMLDivElement | null>;
// }) {
//   const resolvedWaveColor = useCssVar(waveColor as string);
//   const resolvedProgressColor = useCssVar(progressColor as string);
//   const [wavesurfer, setWavesurfer] = useState<WaveSurfer | null>(null);
//   const [isReady, setIsReady] = useState(false);
//   const [isPlaying, setIsPlaying] = useState(false);
//   const [currentTime, setCurrentTime] = useState(0);

//   const url = options.url as string | undefined;
//   const height =
//     (options.height as number | undefined) ?? WAVESURFER_DEFAULTS.height;
//   const barWidth =
//     (options.barWidth as number | undefined) ?? WAVESURFER_DEFAULTS.barWidth;
//   const barGap =
//     (options.barGap as number | undefined) ?? WAVESURFER_DEFAULTS.barGap;
//   const barRadius =
//     (options.barRadius as number | undefined) ?? WAVESURFER_DEFAULTS.barRadius;
//   const minPxPerSec =
//     (options.minPxPerSec as number | undefined) ??
//     WAVESURFER_DEFAULTS.minPxPerSec;

//   useEffect(() => {
//     if (!container.current) return;
//     const ws = WaveSurfer.create({
//       ...WAVESURFER_DEFAULTS,
//       ...options,
//       waveColor: resolvedWaveColor,
//       progressColor: resolvedProgressColor,
//       container: container.current,
//     });
//     setWavesurfer(ws);
//     const unsubs = [
//       ws.on("load", () => {
//         setIsReady(false);
//         setIsPlaying(false);
//         setCurrentTime(0);
//       }),
//       ws.on("ready", () => {
//         setIsReady(true);
//       }),
//       ws.on("play", () => {
//         setIsPlaying(true);
//       }),
//       ws.on("pause", () => {
//         setIsPlaying(false);
//       }),
//       ws.on("timeupdate", () => {
//         setCurrentTime(ws.getCurrentTime());
//       }),
//       ws.on("destroy", () => {
//         setIsReady(false);
//         setIsPlaying(false);
//       }),
//     ];
//     return () => {
//       unsubs.forEach((fn) => fn());
//       ws.destroy();
//     };
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [url, height, barWidth, barGap, barRadius, minPxPerSec]);

//   useEffect(() => {
//     wavesurfer?.setOptions({
//       waveColor: resolvedWaveColor,
//       progressColor: resolvedProgressColor,
//     });
//   }, [wavesurfer, resolvedWaveColor, resolvedProgressColor]);

//   return { wavesurfer, isReady, isPlaying, currentTime };
// }

// // ─── CSS var resolver ────────────────────────────────────────────────────────
// export function useCssVar(value: string): string {
//   const [resolved, setResolved] = useState(value);

//   useEffect(() => {
//     const match = value.match(/^var\((--[^)]+)\)$/);
//     if (!match) {
//       setResolved(value);
//       return;
//     }

//     const varName = match[1];
//     const resolve = () => {
//       const raw = getComputedStyle(document.documentElement)
//         .getPropertyValue(varName)
//         .trim();
//       const isHsl = /^[\d.]+ [\d.]+% [\d.]+%$/.test(raw);
//       setResolved(raw ? (isHsl ? `hsl(${raw})` : raw) : value);
//     };

//     resolve();
//     const observer = new MutationObserver(resolve);
//     observer.observe(document.documentElement, {
//       attributes: true,
//       attributeFilter: ["class", "style", "data-theme"],
//     });
//     return () => observer.disconnect();
//   }, [value]);

//   return resolved;
// }

/**
 * A React component for wavesurfer.js
 *
 * Usage:
 *
 * import WavesurferPlayer from '@wavesurfer/react'
 *
 * <WavesurferPlayer
 *   url="/my-server/audio.ogg"
 *   waveColor="purple"
 *   height={100}
 *   onReady={(wavesurfer) => console.log('Ready!', wavesurfer)}
 * />
 */

import {
  useState,
  useMemo,
  useEffect,
  useRef,
  memo,
  type ReactElement,
  type RefObject,
  createContext,
  useContext,
} from "react";
import WaveSurfer, {
  type WaveSurferEvents,
  type WaveSurferOptions,
} from "wavesurfer.js";

type WavesurferEventHandler<T extends unknown[]> = (
  wavesurfer: WaveSurfer,
  ...args: T
) => void;

type OnWavesurferEvents = {
  [K in keyof WaveSurferEvents as `on${Capitalize<K>}`]?: WavesurferEventHandler<
    WaveSurferEvents[K]
  >;
};

type PartialWavesurferOptions = Omit<WaveSurferOptions, "container">;

/**
 * Props for the Wavesurfer component
 * @public
 */
export type WavesurferProps = PartialWavesurferOptions & OnWavesurferEvents;

/**
 * Use wavesurfer instance
 */
function useWavesurferInstance(
  containerRef: RefObject<HTMLDivElement | null>,
  options: Partial<WaveSurferOptions>,
): WaveSurfer | null {
  const [wavesurfer, setWavesurfer] = useState<WaveSurfer | null>(null);

  // Flatten options object to an array of keys and values to compare them deeply in the hook deps
  // Exclude plugins from deep comparison since they are mutated during initialization
  const optionsWithoutPlugins = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { plugins, ...rest } = options;
    return rest;
  }, [options]);
  const flatOptions = useMemo(
    () => Object.entries(optionsWithoutPlugins).flat(),
    [optionsWithoutPlugins],
  );

  // Create a wavesurfer instance
  useEffect(() => {
    if (!containerRef?.current) return;

    const ws = WaveSurfer.create({
      ...optionsWithoutPlugins,
      plugins: options.plugins,
      container: containerRef.current,
    });

    setWavesurfer(ws);

    return () => {
      ws.destroy();
    };
    // Only recreate if plugins array reference changes (not on mutation)
    // Users should memoize the plugins array to prevent unnecessary re-creation
  }, [containerRef, options.plugins, ...flatOptions]);

  return wavesurfer;
}

/**
 * Use wavesurfer state
 */
function useWavesurferState(wavesurfer: WaveSurfer | null): {
  isReady: boolean;
  isPlaying: boolean;
  currentTime: number;
} {
  const [isReady, setIsReady] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [hasFinished, setHasFinished] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(0);

  useEffect(() => {
    if (!wavesurfer) return;

    const unsubscribeFns = [
      wavesurfer.on("load", () => {
        setIsReady(false);
        setIsPlaying(false);
        setCurrentTime(0);
      }),

      wavesurfer.on("ready", () => {
        setIsReady(true);
        setIsPlaying(false);
        setHasFinished(false);
        setCurrentTime(0);
      }),

      wavesurfer.on("finish", () => {
        setHasFinished(true);
      }),

      wavesurfer.on("play", () => {
        setIsPlaying(true);
      }),

      wavesurfer.on("pause", () => {
        setIsPlaying(false);
      }),

      wavesurfer.on("timeupdate", () => {
        setCurrentTime(wavesurfer.getCurrentTime());
      }),

      wavesurfer.on("destroy", () => {
        setIsReady(false);
        setIsPlaying(false);
      }),
    ];

    return () => {
      unsubscribeFns.forEach((fn) => fn());
    };
  }, [wavesurfer]);

  return useMemo(
    () => ({
      isReady,
      isPlaying,
      hasFinished,
      currentTime,
    }),
    [isPlaying, hasFinished, currentTime, isReady],
  );
}

const EVENT_PROP_RE = /^on([A-Z])/;
const isEventProp = (key: string) => EVENT_PROP_RE.test(key);
const getEventName = (key: string) =>
  key.replace(EVENT_PROP_RE, (_, $1) =>
    $1.toLowerCase(),
  ) as keyof WaveSurferEvents;

/**
 * Parse props into wavesurfer options and events
 */
function useWavesurferProps(
  props: WavesurferProps,
): [PartialWavesurferOptions, OnWavesurferEvents] {
  // Props starting with `on` are wavesurfer events, e.g. `onReady`
  // The rest of the props are wavesurfer options
  return useMemo<[PartialWavesurferOptions, OnWavesurferEvents]>(() => {
    const allOptions = { ...props };
    const allEvents = { ...props };

    for (const key in allOptions) {
      if (isEventProp(key)) {
        delete allOptions[key as keyof WavesurferProps];
      } else {
        delete allEvents[key as keyof WavesurferProps];
      }
    }
    return [allOptions, allEvents];
  }, [props]);
}

/**
 * Subscribe to wavesurfer events
 */
function useWavesurferEvents(
  wavesurfer: WaveSurfer | null,
  events: OnWavesurferEvents,
) {
  const flatEvents = useMemo(() => Object.entries(events).flat(), [events]);

  // Subscribe to events
  useEffect(() => {
    if (!wavesurfer) return;

    const eventEntries = Object.entries(events);
    if (!eventEntries.length) return;

    const unsubscribeFns = eventEntries.map(([name, handler]) => {
      const event = getEventName(name);
      return wavesurfer.on(event, (...args) =>
        (handler as WavesurferEventHandler<WaveSurferEvents[typeof event]>)(
          wavesurfer,
          ...args,
        ),
      );
    });

    return () => {
      unsubscribeFns.forEach((fn) => fn());
    };
  }, [wavesurfer, ...flatEvents]);
}

/**
 * Wavesurfer player component
 * @see https://wavesurfer.xyz/docs/modules/wavesurfer
 * @public
 */
const WavesurferPlayer = memo((props: WavesurferProps): ReactElement => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [options, events] = useWavesurferProps(props);
  const wavesurfer = useWavesurferInstance(containerRef, options);
  useWavesurferEvents(wavesurfer, events);

  // Create a container div
  return <div ref={containerRef} />;
});

/**
 * @public
 */
export default WavesurferPlayer;

/**
 * React hook for wavesurfer.js
 *
 * ```
 * import { useWavesurfer } from '@wavesurfer/react'
 *
 * const App = () => {
 *   const containerRef = useRef<HTMLDivElement | null>(null)
 *
 *   const { wavesurfer, isReady, isPlaying, hasFinished, currentTime } = useWavesurfer({
 *     container: containerRef,
 *     url: '/my-server/audio.ogg',
 *     waveColor: 'purple',
 *     height: 100',
 *   })
 *
 *   return <div ref={containerRef} />
 * }
 * ```
 *
 * @public
 */

const WaveSurferContext = createContext(null);

const WaveSurferProvider = ({ children, audioUrl }) => {
  const [wavesurfer, setWavesurfer] = useState(null);
  const [container, setContainer] = useState(null);

  // Initialize Wavesurfer once without a container
  useEffect(() => {
    const ws = WaveSurfer.create({
      url: audioUrl,
      waveColor: "#d9d9d9",
      progressColor: "#4a90e2",
      // Pass a dummy element or omit container if your version allows,
      // or use a detached div until a real container mounts.
      container: document.createElement("div"),
    });

    setWavesurfer(ws);

    return () => ws.destroy();
  }, [audioUrl]);

  // Dynamically update the container when a component requests it
  useEffect(() => {
    if (wavesurfer && container) {
      wavesurfer.setMediaElement({ container });
    }
  }, [wavesurfer, container]);

  return (
    <WaveSurferContext.Provider value={{ wavesurfer, setContainer }}>
      {children}
    </WaveSurferContext.Provider>
  );
};

export function useWavesurfer({
  container,
  ...options
}: Omit<WaveSurferOptions, "container"> & {
  container: RefObject<HTMLDivElement | null>;
}): ReturnType<typeof useWavesurferState> & {
  wavesurfer: ReturnType<typeof useWavesurferInstance>;
} {
  const wavesurfer = useWavesurferInstance(container, options);
  const state = useWavesurferState(wavesurfer);
  return useMemo(() => ({ ...state, wavesurfer }), [state, wavesurfer]);
}

export const useWaveSurfer = () => useContext(WaveSurferContext);
