import { BaseNodeCard } from "./base-node";
import { StatusDialog } from "@/components/ui/status-dialog";
import { cn } from "@/lib/utils";
import { Handle, NodeProps, Position, useEdges, useNodes } from "@xyflow/react";
import {
  Monitor as MonitorIcon,
  Play as PlayIcon,
  Square as SquareIcon,
  Layers as LayersIcon,
  Disc as DiscIcon,
  Radio as RadioIcon,
  SquareDashedMousePointer,
  ScanEyeIcon,
} from "lucide-react";
import { FlowNodeType, OverlayElement } from "@/types/flow-node";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useScreenCapture } from "@/hooks/useScreenCapture";
import { isValidConnection } from "@/utils/flow-connections";
import { useSetAtom } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import { useTransientNodeState } from "@/store/transientNodeStore";
import { useSettings } from "@/store/settingsStore";
import { getFlowAudioAnalyser } from "@/utils/flowAudioRegistry";
import {
  createH264CanvasEncoder,
  type H264EncoderHandle,
} from "@/utils/webcodecs-streamer";
import type { StreamStats } from "../global";

function drawRoundedRect(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function formatTime(seconds: number): string {
  if (!seconds || isNaN(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function cleanStreamUrl(url: string): string {
  const trimmed = url.trim();
  const twitchMatch = trimmed.match(
    /https?:\/\/(?:www\.)?twitch\.tv\/[^/]+\/(live_[a-zA-Z0-9_]+)/i,
  );
  if (twitchMatch) {
    return `rtmp://live.twitch.tv/app/${twitchMatch[1]}`;
  }
  return trimmed;
}

export function TargetOutputNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const updateNodeData = useSetAtom(updateNodeDataAtom);
  const { settings, updateSettings } = useSettings();
  const { getVal, setVal } = useTransientNodeState(node.id, "targetOutputNode");

  const isPreviewActive = getVal<boolean>("isPreviewActive");
  const isRecording = getVal<boolean>("isRecording");
  const isStreaming = getVal<boolean>("isStreaming");

  const setIsPreviewActive = useCallback(
    (val: boolean) => {
      setVal("isPreviewActive", val);
    },
    [setVal],
  );

  const setIsRecording = useCallback(
    (val: boolean) => {
      setVal("isRecording", val);
    },
    [setVal],
  );

  const setIsStreaming = useCallback(
    (val: boolean) => {
      setVal("isStreaming", val);
    },
    [setVal],
  );

  const [dynamicAspectRatio, setDynamicAspectRatio] = useState<string>("16/9");

  // Recording states
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Edit Overlay window state
  const [editOverlayOpen, setEditOverlayOpenState] = useState(false);
  const editOverlayOpenRef = useRef(false);
  const setEditOverlayOpen = (val: boolean) => {
    editOverlayOpenRef.current = val;
    setEditOverlayOpenState(val);
  };
  const editOverlayOwnsCaptureRef = useRef(false);
  // Timestamp of last frame sent to preview — rate-limits to ~10fps to avoid eating compositor budget
  const lastPreviewBroadcastRef = useRef<number>(0);
  // Whether a canvas.toBlob encode is already in flight (avoid stacking)
  const previewCapturePendingRef = useRef(false);
  // Small offscreen canvas used for downscaling before JPEG encode — keeps encoding fast
  const previewScaleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // Per-overlay OffscreenCanvas cache for visualizer overlays. Visualizers redraw at
  // 30fps max and composite the cached image at full compositor rate, avoiding the
  // per-frame cost of 80+ ctx.stroke() calls (circle) and 128 createLinearGradient()
  // calls (bars) that were starving the main thread during audio playback.
  const visualizerCachesRef = useRef<
    Map<string, {
      canvas: OffscreenCanvas;
      ctx2d: OffscreenCanvasRenderingContext2D;
      lastDrawn: number;
      dataArray: Uint8Array<ArrayBuffer>;
      broadcastArray: number[];
      barsGrad: CanvasGradient | null;
      barsGradH: number;
    }>
  >(new Map());
  // Per-overlay font string cache for text overlays. The font string is rebuilt
  // only when font properties or canvas height change, avoiding a new string
  // allocation every compositor frame per text overlay.
  const textFontCacheRef = useRef<
    Map<string, { key: string; fontStr: string }>
  >(new Map());
  // Per-overlay OffscreenCanvas cache for nowPlaying overlays. The entire card
  // is rendered to an OffscreenCanvas and only re-drawn when content actually
  // changes (title/artist/art/time). On every compositor frame the cached canvas
  // is blitted with a single drawImage call, eliminating per-frame allocations
  // (createLinearGradient, font strings, measureText loops, clip paths).
  const nowPlayingCacheRef = useRef<
    Map<string, { canvas: OffscreenCanvas; contentKey: string }>
  >(new Map());
  // Set to true when overlay topology changes so the next encoded frame is forced
  // to be a keyframe. Sudden overlay additions/removals cause a large inter-frame
  // difference; producing a planned keyframe is cheaper than an oversized P-frame.
  const forceKeyframeRef = useRef(false);
  // Connection status shown in StatusDialog while Edit Overlay is opening
  type EditOverlayDialogStatus = "idle" | "running" | "success" | "error";
  const [editOverlayDialogStatus, setEditOverlayDialogStatus] =
    useState<EditOverlayDialogStatus>("idle");
  const [editOverlayDialogProgress, setEditOverlayDialogProgress] = useState(0);

  // One-time migration: old code stored the RTMP URL in localStorage only.
  // Promote it to settings on first mount so the URL field isn't blank.
  useEffect(() => {
    if (!settings.streamUrl) {
      const legacy = localStorage.getItem("rtmpUrl");
      if (legacy && !legacy.includes("YOUR_KEY")) {
        updateSettings({ streamUrl: legacy });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Streaming states
  // Derived from settings so changes to URL or token are always reflected
  // without a separate sync effect (which could overwrite what the user typed).
  const rtmpUrl = useMemo(() => {
    const base = settings.streamUrl?.trim() || "";
    const token = settings.streamToken?.trim() || "";
    if (!base) return "";
    if (!token) return base;
    return base.endsWith("/") ? `${base}${token}` : `${base}/${token}`;
  }, [settings.streamUrl, settings.streamToken]);
  const [showStreamInput, setShowStreamInput] = useState(false);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);
  // rAF handle for the JPEG fallback capture loop (non-null = fallback streaming active)
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Active WebCodecs encoder handle (null when falling back to the JPEG path)
  const h264EncoderRef = useRef<H264EncoderHandle | null>(null);
  // WebCodecs streaming state, held in refs so the compositor loop can encode
  // each composited frame without re-creating the render callback.
  const isStreamingRef = useRef<boolean>(false);
  const streamFpsRef = useRef<number>(30);
  const streamFrameIndexRef = useRef<number>(0);
  // Locked canvas dimensions for the active stream. Set at stream-start from the
  // encoder-configured size and held constant so the canvas never resizes while
  // streaming (a resize would give the encoder frames of a different size than it
  // was configured for, causing encoder errors and stopping the stream).
  const streamDimsRef = useRef<{ width: number; height: number } | null>(null);
  // Throttle gate for the per-frame visualizer audio-data IPC broadcast.
  const lastAudioBroadcastRef = useRef<number>(0);
  // Timestamp of the last composited frame, for capping the compositor's draw rate.
  const lastCompositeTimeRef = useRef<number>(0);
  // Tracks whether streaming auto-started the capture (so it can be auto-stopped)
  const streamOwnsCaptureRef = useRef<boolean>(false);

  // Audio Analyser states
  const cardAudioContextRef = useRef<AudioContext | null>(null);
  const cardAnalyserRef = useRef<AnalyserNode | null>(null);

  const cardRequestRef = useRef<number | null>(null);
  // Guards against multiple parallel compositor rAF chains (a classic
  // rAF-in-React leak that compounds frame cost over time).
  const compositorActiveRef = useRef<boolean>(false);
  const cardImageCacheRef = useRef<Record<string, HTMLImageElement>>({});

  // Fetch the active capture stream hook
  const { stream, startCapture, stopCapture } = useScreenCapture();

  // Retrieve React Flow layout context (reactively updating when connections change)
  const edges = useEdges();
  const nodes = useNodes();

  // Keep track of audio node playback times in a ref to avoid triggering component re-renders
  // on every 30fps update, which would kill React rendering performance.
  const audioTimesRef = useRef<
    Record<string, { currentTime: number; duration: number }>
  >({});

  useEffect(() => {
    const handleTimeUpdated = (nodeId: string, currentTime: number) => {
      // Find duration of this audio node from flow editor nodes
      const audioNode = nodes.find(
        (n) => n.id === nodeId && n.type === "audioFlowNode",
      );
      const duration =
        audioNode?.data.duration !== undefined
          ? Number(audioNode.data.duration)
          : 0;
      audioTimesRef.current[nodeId] = { currentTime, duration };
    };

    window.electron.onAudioTimeUpdated(handleTimeUpdated);
    return () => {
      window.electron.removeOnAudioTimeUpdated();
    };
  }, [nodes]);

  const isValidSourceConnection = useCallback(
    (connection: any) => {
      return isValidConnection(connection, nodes);
    },
    [nodes],
  );

  const isValidOverlayConnection = useCallback(
    (connection: any) => {
      return isValidConnection(connection, nodes);
    },
    [nodes],
  );

  // Find incoming nodes connected to this Target Node
  const connectedNodes = useMemo(() => {
    const incomingEdges = edges.filter((e) => e.target === node.id);
    return incomingEdges
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter(Boolean) as FlowNodeType[];
  }, [edges, nodes, node.id]);

  // Locate the Capture Source selection node connected to the source handle
  const sourceNode = useMemo(() => {
    const sourceEdge = edges.find(
      (e) =>
        e.target === node.id &&
        e.targetHandle === `handle_${node.id}_source_target`,
    );
    if (!sourceEdge) return null;
    const foundNode = nodes.find(
      (n) => n.id === sourceEdge.source && n.type === "captureSourceNode",
    );
    return (foundNode as FlowNodeType) || null;
  }, [edges, nodes, node.id]);

  // Extract source parameters
  const captureSourceId = sourceNode?.data.captureSourceId;
  const captureAudio = !!sourceNode?.data.captureAudio;
  const captureResolution = sourceNode?.data.captureResolution || "original";
  const captureFrameRate = Number(sourceNode?.data.maxCaptureFrameRate) || 30;

  // Build resolutionPresets mapping based on screen bounds
  const [displays, setDisplays] = useState<any[]>([]);
  useEffect(() => {
    window.electron
      .getDisplays()
      .then(setDisplays)
      .catch((err) => {
        console.error("[TargetOutputNode] Failed to fetch displays:", err);
      });
  }, []);

  const resolutionPresets = useMemo(() => {
    if (captureSourceId?.startsWith("screen:") && displays.length > 0) {
      const idStr = captureSourceId.replace("screen:", "");
      const activeDisplay =
        displays.find((d) => String(d.id) === idStr) ||
        displays.find((d) => d.isPrimary) ||
        displays[0];
      if (activeDisplay) {
        const w = activeDisplay.bounds.width;
        const h = activeDisplay.bounds.height;
        const ratio = w / h;
        let aspectString = "auto";
        if (Math.abs(ratio - 16 / 9) < 0.01) aspectString = "16/9";
        else if (Math.abs(ratio - 21 / 9) < 0.05) aspectString = "21/9";
        else aspectString = `${w}/${h}`;

        return {
          original: {
            label: `Original (${w}x${h})`,
            aspect: aspectString,
            width: w,
            height: h,
          },
          scale_75: {
            label: `75% Scale (${Math.round(w * 0.75)}x${Math.round(h * 0.75)})`,
            aspect: aspectString,
            width: Math.round(w * 0.75),
            height: Math.round(h * 0.75),
          },
          scale_50: {
            label: `50% Scale (${Math.round(w * 0.5)}x${Math.round(h * 0.5)})`,
            aspect: aspectString,
            width: Math.round(w * 0.5),
            height: Math.round(h * 0.5),
          },
          hd: {
            label: "16:9 HD (1280x720)",
            aspect: "16/9",
            width: 1280,
            height: 720,
          },
          fhd: {
            label: "16:9 Full HD (1920x1080)",
            aspect: "16/9",
            width: 1920,
            height: 1080,
          },
        };
      }
    }
    return {
      original: {
        label: "Original / Fit Window",
        aspect: "auto",
        width: undefined,
        height: undefined,
      },
      hd: {
        label: "16:9 HD (1280x720)",
        aspect: "16/9",
        width: 1280,
        height: 720,
      },
      fhd: {
        label: "16:9 Full HD (1920x1080)",
        aspect: "16/9",
        width: 1920,
        height: 1080,
      },
    };
  }, [captureSourceId, displays]);

  const activePreset =
    resolutionPresets[captureResolution as keyof typeof resolutionPresets] ||
    resolutionPresets.original;

  // How the source is fit into the (possibly differently-shaped) output canvas.
  const fitMode = node.data.fitMode || "contain";
  // Ref so the running compositor rAF loop always sees the current fitMode
  // without needing to restart (async useEffect chain is too slow / fragile).
  const fitModeRef = useRef(fitMode);
  fitModeRef.current = fitMode;
  const setFitMode = useCallback(
    (mode: "contain" | "cover" | "stretch") => {
      updateNodeData({ id: node.id, patch: { fitMode: mode } });
    },
    [updateNodeData, node.id],
  );

  // Capture at the source's native resolution (never the output preset). Pinning
  // capture to a mismatched-aspect preset makes Chromium pad the frame to that
  // box with uninitialised-YUV "green bars". We capture native and let the
  // compositor do the aspect-correct downscale below.
  const nativeCaptureDims = useMemo(
    () => ({
      width: resolutionPresets.original.width,
      height: resolutionPresets.original.height,
    }),
    [resolutionPresets],
  );

  // Locate the Overlay Compositor node connected to the overlays target handle
  const connectedOverlayGroupNode = useMemo(() => {
    const overlayEdge = edges.find(
      (e) =>
        e.target === node.id &&
        e.targetHandle === `handle_${node.id}_overlay_target`,
    );
    if (!overlayEdge) return null;
    const foundNode = nodes.find(
      (n) => n.id === overlayEdge.source && n.type === "overlayGroupNode",
    );
    return (foundNode as FlowNodeType) || null;
  }, [edges, nodes, node.id]);

  // Extract and compile all overlay configurations connected to the Overlay Compositor node
  const overlays = useMemo(() => {
    if (!connectedOverlayGroupNode) return [];

    // Find all edges pointing to the connected overlayGroupNode
    const incomingEdgesToGroup = edges.filter(
      (e) => e.target === connectedOverlayGroupNode.id,
    );

    // Find the corresponding overlay nodes
    const overlayNodes = incomingEdgesToGroup
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter(
        (n): n is FlowNodeType =>
          !!(
            n &&
            [
              "textOverlayNode",
              "colorOverlayNode",
              "imageOverlayNode",
              "visualizerOverlayNode",
              "nowPlayingNode",
            ].includes(n.type || "")
          ),
      )
      .sort((a, b) => a.position.y - b.position.y);

    const list: OverlayElement[] = [];
    overlayNodes.forEach((n) => {
      const type = (
        n.type === "nowPlayingNode"
          ? "nowPlaying"
          : n.type?.replace("OverlayNode", "")
      ) as OverlayElement["type"];
      const data = n.data as any;

      let albumArt = "";
      let title = "";
      let artist = "";
      let audioNodeId = "";
      let duration = 0;

      if (n.type === "nowPlayingNode") {
        const audioEdge = edges.find((e) => e.target === n.id);
        if (audioEdge) {
          const audioNode = nodes.find(
            (an) => an.id === audioEdge.source && an.type === "audioFlowNode",
          );
          if (audioNode) {
            albumArt = (audioNode.data.albumArt as string) || "";
            title = (audioNode.data.title as string) || "Unknown Title";
            artist = (audioNode.data.artist as string) || "Unknown Artist";
            audioNodeId = audioNode.id;
            duration = Number(audioNode.data.duration) || 0;
          }
        }
      }

      list.push({
        id: n.id,
        type,
        x: data.x !== undefined ? Number(data.x) : 10,
        y: data.y !== undefined ? Number(data.y) : 10,
        width: data.width !== undefined ? Number(data.width) : 30,
        height: data.height !== undefined ? Number(data.height) : 20,
        opacity: data.opacity !== undefined ? Number(data.opacity) : 1,
        textContent: data.textContent as string,
        fontSize: data.fontSize !== undefined ? Number(data.fontSize) : 5,
        textColor: data.textColor as string,
        backgroundColor: data.backgroundColor as string,
        imagePath: data.imagePath as string,
        visualizerType: data.visualizerType as string,
        fontFamily: data.fontFamily as string,
        fontWeight: data.fontWeight as string,
        fontStyle: data.fontStyle as string,
        albumArt,
        title,
        artist,
        audioNodeId,
        duration,
      });
    });

    return list;
  }, [edges, nodes, connectedOverlayGroupNode]);

  // Refs so the compositor rAF loop always reads the latest overlays/edges without
  // being a dep of renderCardCompositor. Without this, any node update anywhere in
  // the graph (audio time, selection, etc.) causes overlays useMemo to recompute
  // a new array reference → renderCardCompositor useCallback recreates → useEffect
  // fires → main-thread churn that delays rAF timing → encoder queue backs up →
  // stall-then-catchup even with static image/text overlays.
  const overlaysRef = useRef(overlays);
  overlaysRef.current = overlays;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;

  // Synchronise overlays to main process whenever they change
  const prevOverlaysRef = useRef<string>("");
  const prevOverlayTopologyRef = useRef<string>("");
  useEffect(() => {
    const overlaysJson = JSON.stringify(overlays);
    if (prevOverlaysRef.current !== overlaysJson) {
      prevOverlaysRef.current = overlaysJson;
      window.electron.setOverlays(overlays);

      // Only force a keyframe on topology changes (overlay added or removed).
      // Property edits (position, text, colour) cause normal P-frame size
      // increases the encoder handles naturally — forcing a keyframe on every
      // Apply click compounds encoder queue pressure and grows stream delay.
      const topology = overlays.map((o) => o.id).join(",");
      if (topology !== prevOverlayTopologyRef.current) {
        prevOverlayTopologyRef.current = topology;
        forceKeyframeRef.current = true;
      }
    }
  }, [overlays]);

  // Watch for preview state and parameter changes to manage screen capture stream declaratively
  const lastCaptureParamsRef = useRef<{
    sourceId: string;
    audio: boolean;
    width: number;
    height: number;
  } | null>(null);

  useEffect(() => {
    if ((isPreviewActive || editOverlayOpen) && captureSourceId) {
      const currentParams = {
        sourceId: captureSourceId,
        audio: captureAudio,
        width: nativeCaptureDims.width,
        height: nativeCaptureDims.height,
      };

      const hasChanged =
        !lastCaptureParamsRef.current ||
        lastCaptureParamsRef.current.sourceId !== currentParams.sourceId ||
        lastCaptureParamsRef.current.audio !== currentParams.audio ||
        lastCaptureParamsRef.current.width !== currentParams.width ||
        lastCaptureParamsRef.current.height !== currentParams.height;

      if (hasChanged) {
        console.log(
          `[TargetOutputNode] Starting/restarting stream with target: ${captureSourceId}`,
        );
        lastCaptureParamsRef.current = currentParams;
        if (editOverlayOpen && !isPreviewActive) {
          editOverlayOwnsCaptureRef.current = true;
        }
        startCapture(captureSourceId, captureAudio, captureFrameRate, {
          maxWidth: nativeCaptureDims.width,
          maxHeight: nativeCaptureDims.height,
        }).then((activeStream) => {
          if (!activeStream) {
            setIsPreviewActive(false);
            lastCaptureParamsRef.current = null;
            editOverlayOwnsCaptureRef.current = false;
          }
        });
      }
    } else if (!isPreviewActive && !editOverlayOpen) {
      lastCaptureParamsRef.current = null;
    }
  }, [
    captureSourceId,
    captureAudio,
    captureFrameRate,
    nativeCaptureDims.width,
    nativeCaptureDims.height,
    isPreviewActive,
    editOverlayOpen,
    startCapture,
    setIsPreviewActive,
  ]);

  // Handle stream assignment to HTMLVideoElement.
  // Guard against double-assignment: startStreaming sets srcObject directly so
  // the video is ready before the canvas-ready poll starts. Without the guard
  // a second assignment (with the same MediaStream object) would tear down the
  // WGC texture handle and break capture.
  useEffect(() => {
    if (videoRef.current && stream) {
      if (videoRef.current.srcObject !== stream) {
        videoRef.current.srcObject = stream;
      }
      videoRef.current.play().catch((err) => {
        console.error("[TargetOutputNode] Video playback failed:", err);
      });
    }
  }, [stream]);

  // Audio Analyser Setup for visualizer overlays in the card preview
  useEffect(() => {
    if (stream && stream.getAudioTracks().length > 0) {
      try {
        const AudioContextClass =
          window.AudioContext || (window as any).webkitAudioContext;
        const audioContext = new AudioContextClass();
        const source = audioContext.createMediaStreamSource(stream);
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        cardAudioContextRef.current = audioContext;
        cardAnalyserRef.current = analyser;
      } catch (err) {
        console.error("[TargetOutputNode] Audio analyser setup failed:", err);
      }
    }
    return () => {
      if (cardAudioContextRef.current) {
        cardAudioContextRef.current.close();
        cardAudioContextRef.current = null;
        cardAnalyserRef.current = null;
      }
    };
  }, [stream]);

  // Compositor canvas render loop
  const renderCardCompositor = useCallback(() => {
    // Single-loop guard: if deactivated, stop rescheduling so the chain dies.
    if (!compositorActiveRef.current) {
      cardRequestRef.current = null;
      return;
    }
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas || !video || video.readyState < 2) {
      cardRequestRef.current = requestAnimationFrame(renderCardCompositor);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      cardRequestRef.current = requestAnimationFrame(renderCardCompositor);
      return;
    }

    // Cap the draw rate: target stream fps while streaming, otherwise 60fps for
    // preview. Without this the loop composites at the monitor refresh rate
    // (e.g. 144Hz) — wasting main-thread time and starving the encoder.
    const now = performance.now();
    const targetFps = isStreamingRef.current ? streamFpsRef.current : 60;
    if (now - lastCompositeTimeRef.current < 1000 / targetFps) {
      cardRequestRef.current = requestAnimationFrame(renderCardCompositor);
      return;
    }
    lastCompositeTimeRef.current = now;

    // While streaming, lock the canvas to the encoder-configured dimensions so
    // a window resize (or any other change to videoWidth/Height) cannot give the
    // encoder frames of a different size — that would cause encoder errors and
    // stop the stream. For preview only, size dynamically from the video.
    const streamLocked = isStreamingRef.current && streamDimsRef.current;
    const rawWidth = streamLocked
      ? streamDimsRef.current!.width
      : activePreset.width || video.videoWidth || 1280;
    const rawHeight = streamLocked
      ? streamDimsRef.current!.height
      : activePreset.height || video.videoHeight || 720;
    // Force even dimensions — H.264 (yuv420p) requires width/height divisible by 2.
    const targetWidth = rawWidth - (rawWidth % 2);
    const targetHeight = rawHeight - (rawHeight % 2);
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    // High-quality scaling for the video downscale to the target resolution.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    // 1. Draw base video frame with aspect-correct fit.
    // Clear to black first so any letterbox/pillarbox area is clean black
    // (drawn in RGBA → proper black after yuv420p encode), never the green
    // "uninitialised YUV" bars Chromium produces when it pads a capture.
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (vw > 0 && vh > 0) {
      const fm = fitModeRef.current || "contain";
      if (fm === "stretch") {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      } else {
        const scale =
          fm === "contain"
            ? Math.min(canvas.width / vw, canvas.height / vh)
            : Math.max(canvas.width / vw, canvas.height / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        const dx = (canvas.width - dw) / 2;
        const dy = (canvas.height - dh) / 2;
        ctx.drawImage(video, dx, dy, dw, dh);
      }
    }

    // Throttle the visualizer audio-data IPC broadcast to ~25fps — sending a
    // fresh array per visualizer every frame is pure main-thread overhead.
    const broadcastAudio = now - lastAudioBroadcastRef.current >= 40;
    if (broadcastAudio) lastAudioBroadcastRef.current = now;

    // 2. Draw overlays sequentially
    overlaysRef.current.forEach((overlay) => {
      ctx.save();
      ctx.globalAlpha = overlay.opacity ?? 1;

      // Map percentage bounds to absolute canvas coordinates
      const xVal = (overlay.x / 100) * canvas.width;
      const yVal = (overlay.y / 100) * canvas.height;
      const wVal = (overlay.width / 100) * canvas.width;
      const hVal = (overlay.height / 100) * canvas.height;

      if (overlay.type === "color" && overlay.backgroundColor) {
        ctx.fillStyle = overlay.backgroundColor;
        ctx.fillRect(xVal, yVal, wVal, hVal);
      } else if (overlay.type === "text" && overlay.textContent) {
        const sizePx = Math.round(
          (overlay.fontSize || 4) * (canvas.height / 100),
        );
        const fontKey = `${sizePx}|${overlay.fontStyle ?? "normal"}|${overlay.fontWeight ?? "normal"}|${overlay.fontFamily ?? "Inter, sans-serif"}`;
        let fontEntry = textFontCacheRef.current.get(overlay.id);
        if (!fontEntry || fontEntry.key !== fontKey) {
          fontEntry = {
            key: fontKey,
            fontStr: `${overlay.fontStyle || "normal"} ${overlay.fontWeight || "normal"} ${sizePx}px ${overlay.fontFamily || "Inter, sans-serif"}`,
          };
          textFontCacheRef.current.set(overlay.id, fontEntry);
        }
        ctx.font = fontEntry.fontStr;
        ctx.fillStyle = overlay.textColor || "#ffffff";
        ctx.textBaseline = "top";
        ctx.fillText(overlay.textContent, xVal, yVal);
      } else if (overlay.type === "image" && overlay.imagePath) {
        let img = cardImageCacheRef.current[overlay.imagePath];
        if (!img) {
          img = new Image();
          img.src =
            overlay.imagePath.startsWith("http") ||
            overlay.imagePath.startsWith("file://")
              ? overlay.imagePath
              : `file:///${overlay.imagePath.replace(/\\/g, "/")}`;
          cardImageCacheRef.current[overlay.imagePath] = img;
        }
        if (img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, xVal, yVal, wVal, hVal);
        }
      } else if (overlay.type === "visualizer") {
        // Find if this visualizer node has a connected audio node
        const edgeToVisualizer = edgesRef.current.find((e) => e.target === overlay.id);
        let analyser: AnalyserNode | null = null;
        if (edgeToVisualizer) {
          analyser = getFlowAudioAnalyser(edgeToVisualizer.source);
        }
        if (!analyser) {
          analyser = cardAnalyserRef.current;
        }

        if (analyser) {
          const vType = overlay.visualizerType || "bars";
          const bufferLength = analyser.frequencyBinCount;

          // ── OffscreenCanvas + dataArray cache ────────────────────────────
          // Redraw the visualizer at 30fps max; composite at full compositor
          // rate via drawImage (a cheap GPU blit). dataArray is reused each
          // frame to avoid per-frame Uint8Array allocations and GC pressure.
          const W = Math.max(1, Math.round(wVal));
          const H = Math.max(1, Math.round(hVal));
          let cache = visualizerCachesRef.current.get(overlay.id);
          const needsResize =
            !cache || cache.canvas.width !== W || cache.canvas.height !== H;
          const needsNewBuffer =
            !cache || cache.dataArray.length !== bufferLength;
          if (needsResize || needsNewBuffer) {
            const newCanvas = new OffscreenCanvas(W, H);
            const newCtx = newCanvas.getContext("2d");
            if (!newCtx) return;
            cache = {
              canvas: newCanvas,
              ctx2d: newCtx,
              lastDrawn: -Infinity,
              dataArray: new Uint8Array(new ArrayBuffer(bufferLength)),
              broadcastArray: new Array<number>(bufferLength).fill(0),
              barsGrad: null,
              barsGradH: -1,
            };
            visualizerCachesRef.current.set(overlay.id, cache);
          }
          if (!cache) return;

          // Only sample audio data when we're about to redraw or broadcast.
          const needsRedraw = now - cache.lastDrawn >= 33 || needsResize;
          if (needsRedraw || broadcastAudio) {
            if (vType === "wave") {
              analyser.getByteTimeDomainData(cache.dataArray);
            } else {
              analyser.getByteFrequencyData(cache.dataArray);
            }

            if (broadcastAudio) {
              // Reuse the pre-allocated number array to avoid a new Array
              // allocation on every broadcast tick (~25fps per visualizer).
              for (let i = 0; i < cache.dataArray.length; i++) {
                cache.broadcastArray[i] = cache.dataArray[i];
              }
              window.parent
                ? (window.parent as any).electron?.sendAudioData?.(
                    overlay.id,
                    cache.broadcastArray,
                  )
                : window.electron?.sendAudioData?.(
                    overlay.id,
                    cache.broadcastArray,
                  );
            }
          }

          if (needsRedraw) {
            cache.lastDrawn = now;
            const oc = cache.ctx2d;
            oc.clearRect(0, 0, W, H);
            oc.fillStyle = overlay.backgroundColor || "rgba(0, 0, 0, 0.3)";
            oc.fillRect(0, 0, W, H);

            if (vType === "wave") {
              oc.strokeStyle = "#06b6d4";
              oc.lineWidth = 2.5;
              oc.beginPath();
              const sliceWidth = W / bufferLength;
              let lx = 0;
              for (let i = 0; i < bufferLength; i++) {
                const ly = ((cache.dataArray[i] / 128.0) * H) / 2;
                if (i === 0) oc.moveTo(lx, ly);
                else oc.lineTo(lx, ly);
                lx += sliceWidth;
              }
              oc.stroke();
            } else if (vType === "circle") {
              const cx = W / 2;
              const cy = H / 2;
              const baseR = Math.min(W, H) * 0.15;
              const maxR = Math.min(W, H) * 0.45;
              const step = Math.max(1, Math.floor(bufferLength / 80));
              // Batch segments into 8 color bands — 8 stroke() calls instead
              // of one per segment (was 80-128 GPU flushes per frame).
              const NUM_BANDS = 8;
              for (let band = 0; band < NUM_BANDS; band++) {
                const hue = 180 + (band / NUM_BANDS) * 80;
                oc.strokeStyle = `hsl(${hue}, 85%, 55%)`;
                oc.lineWidth = 2.5;
                oc.beginPath();
                const bandStart = Math.round((band / NUM_BANDS) * bufferLength);
                const bandEnd = Math.round(
                  ((band + 1) / NUM_BANDS) * bufferLength,
                );
                for (let i = bandStart; i < bandEnd; i += step) {
                  const angle = (i / bufferLength) * Math.PI * 2;
                  const r = baseR + (cache.dataArray[i] / 255) * (maxR - baseR);
                  oc.moveTo(
                    cx + Math.cos(angle) * baseR,
                    cy + Math.sin(angle) * baseR,
                  );
                  oc.lineTo(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
                }
                oc.stroke();
              }
            } else if (vType === "blocks") {
              const numBlocksY = 8;
              const step = Math.max(1, Math.floor(bufferLength / 40));
              const displayCount = Math.floor(bufferLength / step);
              const barWidth = W / displayCount;
              const blockHeight = H / numBlocksY - 1.5;
              let posX = 0;
              for (let i = 0; i < bufferLength; i += step) {
                const blocksToDraw = Math.round(
                  (cache.dataArray[i] / 255) * numBlocksY,
                );
                for (let j = 0; j < blocksToDraw; j++) {
                  oc.fillStyle =
                    j < numBlocksY * 0.4
                      ? "#6366f1"
                      : j < numBlocksY * 0.75
                        ? "#3b82f6"
                        : "#06b6d4";
                  oc.fillRect(
                    posX,
                    H - (j + 1) * (blockHeight + 1.5),
                    barWidth - 1.5,
                    blockHeight,
                  );
                }
                posX += barWidth;
              }
            } else if (vType === "dots") {
              const dotCount = 24;
              const dotSpacing = W / dotCount;
              oc.fillStyle = "#06b6d4";
              for (let i = 0; i < dotCount; i++) {
                const amplitude =
                  cache.dataArray[Math.floor((i / dotCount) * bufferLength)] / 255;
                oc.beginPath();
                oc.arc(
                  i * dotSpacing + dotSpacing / 2,
                  H - amplitude * H,
                  Math.max(2.5, amplitude * 7),
                  0,
                  Math.PI * 2,
                );
                oc.fill();
              }
            } else {
              // bars (default) — gradient cached per overlay; only rebuilt when
              // canvas height changes (previously created every 33ms redraw).
              const barWidth = (W / bufferLength) * 1.5;
              if (!cache.barsGrad || cache.barsGradH !== H) {
                cache.barsGrad = oc.createLinearGradient(0, H, 0, 0);
                cache.barsGrad.addColorStop(0, "#6366f1");
                cache.barsGrad.addColorStop(1, "#06b6d4");
                cache.barsGradH = H;
              }
              oc.fillStyle = cache.barsGrad;
              let posX = 0;
              for (let i = 0; i < bufferLength; i++) {
                const barHeight = (cache.dataArray[i] / 255) * H;
                oc.fillRect(posX, H - barHeight, barWidth - 1, barHeight);
                posX += barWidth + 1;
                if (posX >= W) break;
              }
            }
          }

          // Composite cached visualizer onto the main compositor canvas.
          ctx.drawImage(cache.canvas, xVal, yVal);
        }
      } else if (overlay.type === "nowPlaying") {
        // Draw Now Playing Overlay — rendered to an OffscreenCanvas, blitted here
        // with a single drawImage. The OffscreenCanvas is only re-drawn when
        // content actually changes, so a static (no-audio) overlay produces zero
        // per-frame allocations on the compositor canvas.
        const tracking = overlay.audioNodeId
          ? audioTimesRef.current[overlay.audioNodeId]
          : null;
        const curTime = tracking ? tracking.currentTime : 0;
        const totalDur = tracking ? tracking.duration : 0;
        const pct = totalDur > 0 ? curTime / totalDur : 0;

        const W = Math.round(wVal);
        const H = Math.round(hVal);
        // Timer updates at 1-second resolution; progress bar at 1% resolution.
        const contentKey = `${W}|${H}|${overlay.title ?? ""}|${overlay.artist ?? ""}|${overlay.albumArt ?? ""}|${Math.floor(curTime)}|${Math.floor(pct * 100)}`;

        let npCache = nowPlayingCacheRef.current.get(overlay.id);
        const needsNewCanvas = !npCache || npCache.canvas.width !== W || npCache.canvas.height !== H;
        const needsRedraw = needsNewCanvas || !npCache || npCache.contentKey !== contentKey;

        if (needsRedraw) {
          const npCanvas = needsNewCanvas ? new OffscreenCanvas(W, H) : npCache.canvas;
          const oc = npCanvas.getContext("2d");
          if (oc) {
            const pad = H * 0.12;
            const artSize = H - pad * 2;
            const artX = pad;
            const artY = pad;
            const textX = artX + artSize + pad;
            const titleY = pad + artSize * 0.12;
            const artistY = pad + artSize * 0.48;

            oc.clearRect(0, 0, W, H);

            // Card background
            drawRoundedRect(oc, 0, 0, W, H, H * 0.15);
            oc.fillStyle = "rgba(12, 12, 12, 0.85)";
            oc.fill();
            oc.strokeStyle = "rgba(255, 255, 255, 0.08)";
            oc.lineWidth = 1;
            oc.stroke();

            // Cover art with rounded clip
            oc.save();
            drawRoundedRect(oc, artX, artY, artSize, artSize, artSize * 0.12);
            oc.clip();

            let img = overlay.albumArt
              ? cardImageCacheRef.current[overlay.albumArt]
              : null;
            if (overlay.albumArt && !img) {
              img = new Image();
              img.src = overlay.albumArt;
              cardImageCacheRef.current[overlay.albumArt] = img;
            }

            if (img && img.complete && img.naturalWidth > 0) {
              oc.drawImage(img, artX, artY, artSize, artSize);
            } else {
              const grad = oc.createLinearGradient(artX, artY, artX + artSize, artY + artSize);
              grad.addColorStop(0, "#4f46e5");
              grad.addColorStop(1, "#06b6d4");
              oc.fillStyle = grad;
              oc.fill();
              oc.fillStyle = "#ffffff";
              oc.font = `${artSize * 0.4}px sans-serif`;
              oc.textAlign = "center";
              oc.textBaseline = "middle";
              oc.fillText("🎵", artX + artSize / 2, artY + artSize / 2);
            }
            oc.restore();

            // Title
            const maxTextWidth = W - (pad * 3 + artSize) - pad;
            oc.fillStyle = "#ffffff";
            oc.textAlign = "left";
            oc.textBaseline = "top";
            oc.font = `bold ${artSize * 0.22}px Inter, sans-serif`;
            let displayTitle = overlay.title || "No Track Connected";
            if (oc.measureText(displayTitle).width > maxTextWidth) {
              while (displayTitle.length > 0 && oc.measureText(displayTitle + "...").width > maxTextWidth) {
                displayTitle = displayTitle.slice(0, -1);
              }
              displayTitle += "...";
            }
            oc.fillText(displayTitle, textX, titleY);

            // Artist
            oc.fillStyle = "#a1a1aa";
            oc.font = `500 ${artSize * 0.16}px Inter, sans-serif`;
            let displayArtist = overlay.artist || "Connect Audio Source";
            if (oc.measureText(displayArtist).width > maxTextWidth) {
              while (displayArtist.length > 0 && oc.measureText(displayArtist + "...").width > maxTextWidth) {
                displayArtist = displayArtist.slice(0, -1);
              }
              displayArtist += "...";
            }
            oc.fillText(displayArtist, textX, artistY);

            // Progress bar
            const progressY = H - pad * 1.6;
            const timerSpace = artSize * 0.75;
            const barW = Math.max(10, W - (pad * 3 + artSize) - timerSpace - pad * 2);
            oc.fillStyle = "rgba(255, 255, 255, 0.1)";
            oc.beginPath();
            drawRoundedRect(oc, textX, progressY, barW, H * 0.04, H * 0.02);
            oc.fill();
            if (pct > 0) {
              oc.fillStyle = "#6366f1";
              oc.beginPath();
              drawRoundedRect(oc, textX, progressY, barW * pct, H * 0.04, H * 0.02);
              oc.fill();
            }

            // Timer
            oc.fillStyle = "#a1a1aa";
            oc.font = `500 ${artSize * 0.14}px monospace, sans-serif`;
            oc.textAlign = "right";
            oc.textBaseline = "middle";
            oc.fillText(
              `${formatTime(curTime)} / ${formatTime(totalDur)}`,
              W - pad,
              progressY + H * 0.02,
            );

            npCache = { canvas: npCanvas, contentKey };
            nowPlayingCacheRef.current.set(overlay.id, npCache);
          }
        }

        if (npCache) {
          ctx.drawImage(npCache.canvas, xVal, yVal);
        }
      }

      ctx.restore();
    });

    // 3. Send composited frame to Edit Overlay window at ~10fps via IPC relay.
    // We scale down to 640×360 on an offscreen canvas before JPEG encoding —
    // encoding the full compositor canvas (1600+ px wide) at 30fps costs too many
    // main-thread ms and degrades the compositor itself.
    if (editOverlayOpenRef.current && !previewCapturePendingRef.current) {
      if (now - lastPreviewBroadcastRef.current >= 100) {
        lastPreviewBroadcastRef.current = now;
        previewCapturePendingRef.current = true;

        // Lazily create the scale canvas once
        if (!previewScaleCanvasRef.current) {
          previewScaleCanvasRef.current = document.createElement("canvas");
        }
        const sc = previewScaleCanvasRef.current;
        const PW = 640,
          PH = 360;
        if (sc.width !== PW) sc.width = PW;
        if (sc.height !== PH) sc.height = PH;
        sc.getContext("2d")?.drawImage(canvas, 0, 0, PW, PH);

        sc.toBlob(
          (blob) => {
            previewCapturePendingRef.current = false;
            if (!blob || !editOverlayOpenRef.current) return;
            blob
              .arrayBuffer()
              .then((buf) => {
                if (editOverlayOpenRef.current) {
                  window.electron.sendPreviewFrame(buf, PW, PH);
                }
              })
              .catch(() => {
                /* blob → arrayBuffer failed, skip frame */
              });
          },
          "image/jpeg",
          0.7,
        );
      }
    }

    // 4. Encode this freshly-composited frame for the WebCodecs stream.
    // The whole pass is already gated to the target fps above, so every
    // composited frame maps 1:1 to an encoded frame.
    if (isStreamingRef.current && h264EncoderRef.current) {
      const forceKf = forceKeyframeRef.current;
      forceKeyframeRef.current = false;
      h264EncoderRef.current.encodeCanvas(
        canvas,
        streamFrameIndexRef.current++,
        forceKf,
      );
    }

    cardRequestRef.current = requestAnimationFrame(renderCardCompositor);
  }, [activePreset]);

  // Handle compositor loop activation — runs when preview, streaming, or edit overlay is active
  useEffect(() => {
    if ((isPreviewActive || isStreaming || editOverlayOpen) && stream) {
      compositorActiveRef.current = true;
      if (cardRequestRef.current === null) {
        cardRequestRef.current = requestAnimationFrame(renderCardCompositor);
      }
    }
    return () => {
      compositorActiveRef.current = false;
      if (cardRequestRef.current) {
        cancelAnimationFrame(cardRequestRef.current);
        cardRequestRef.current = null;
      }
    };
  }, [
    isPreviewActive,
    isStreaming,
    editOverlayOpen,
    stream,
    renderCardCompositor,
  ]);

  const handleEditOverlay = useCallback(async () => {
    if (!captureSourceId) return;
    setEditOverlayDialogStatus("running");
    setEditOverlayDialogProgress(33);
    setEditOverlayOpen(true);
    await window.electron.openEditOverlay({ aspect: activePreset.aspect });
  }, [captureSourceId, activePreset.aspect]);

  // When the Edit Overlay window is closed externally, clean up
  useEffect(() => {
    window.electron.onEditOverlayClosed(() => {
      setEditOverlayOpen(false);
      setEditOverlayDialogStatus("idle");
      setEditOverlayDialogProgress(0);
      previewCapturePendingRef.current = false;
      if (editOverlayOwnsCaptureRef.current && !isStreamingRef.current) {
        stopCapture();
        editOverlayOwnsCaptureRef.current = false;
      }
    });
    return () => {
      window.electron.removeOnEditOverlayClosed();
    };
  }, [stopCapture]);

  // Advance dialog to 66% when stream becomes ready, then listen for first frame confirmation
  useEffect(() => {
    if (editOverlayOpen && stream) {
      setEditOverlayDialogProgress(66);
    }
  }, [editOverlayOpen, stream]);

  useEffect(() => {
    window.electron.onEditOverlayConnected(() => {
      setEditOverlayDialogStatus("success");
      setEditOverlayDialogProgress(100);
      setTimeout(() => setEditOverlayDialogStatus("idle"), 1500);
    });
    return () => {
      window.electron.removeOnEditOverlayConnected();
    };
  }, []);

  const handleTogglePreview = useCallback(() => {
    if (isPreviewActive) {
      stopCapture();
      setIsPreviewActive(false);
    } else {
      if (!captureSourceId) return;
      setIsPreviewActive(true);
    }
  }, [isPreviewActive, captureSourceId, setIsPreviewActive, stopCapture]);

  const handleVideoLoadedMetadata = useCallback(
    (e: React.SyntheticEvent<HTMLVideoElement>) => {
      const video = e.currentTarget;
      if (video.videoWidth && video.videoHeight) {
        setDynamicAspectRatio(`${video.videoWidth}/${video.videoHeight}`);
      }
    },
    [],
  );

  // Disk Capture Recording
  const startRecording = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const streamToRecord = (canvas as any).captureStream
      ? (canvas as any).captureStream(60)
      : null;
    if (!streamToRecord) {
      console.error("Canvas captureStream is not supported.");
      return;
    }

    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        streamToRecord.addTrack(track);
      });
    }

    const recordBitrate = (settings.recordingBitrateKbps || 12000) * 1000;
    let options = {
      mimeType: "video/webm;codecs=h264",
      videoBitsPerSecond: recordBitrate,
    };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = {
        mimeType: "video/webm;codecs=vp9",
        videoBitsPerSecond: recordBitrate,
      };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = {
        mimeType: "video/webm",
        videoBitsPerSecond: recordBitrate,
      };
    }

    console.log(
      "[TargetOutputNode] Starting MediaRecorder with mimeType:",
      options.mimeType,
    );

    const recorder = new MediaRecorder(streamToRecord, options);
    recordedChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = async () => {
      const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
      const arrayBuffer = await blob.arrayBuffer();
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileName = `sonicplank-capture-${timestamp}.webm`;
      try {
        await window.electron.saveRecording(
          fileName,
          arrayBuffer,
          settings.recordingPath,
        );
        console.log("[TargetOutputNode] Disk capture saved successfully.");
      } catch (err) {
        console.error(
          "[TargetOutputNode] Failed to save capture to disk:",
          err,
        );
      }
    };

    recorder.start(100);
    mediaRecorderRef.current = recorder;
    setIsRecording(true);
  }, [stream]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  // RTMP Streaming — Phase 1 GPU-offload pipeline.
  // Preferred path: the compositor canvas is encoded to H.264 on the GPU by a
  // WebCodecs VideoEncoder (off the JS main thread), and FFmpeg only muxes to
  // FLV (`-c copy`). No JPEG generation loss, no FFmpeg re-encode.
  // Fallback path (no WebCodecs H.264): the legacy canvas → JPEG → FFmpeg
  // transcode loop.
  const startStreaming = useCallback(async () => {
    if (!rtmpUrl || !captureSourceId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    // If no capture stream is active (preview not open), start one silently
    let activeStream = stream;
    if (!activeStream) {
      activeStream = await startCapture(
        captureSourceId,
        captureAudio,
        captureFrameRate,
        {
          maxWidth: nativeCaptureDims.width,
          maxHeight: nativeCaptureDims.height,
        },
      );
      if (!activeStream) {
        console.error(
          "[TargetOutputNode] Failed to start capture for streaming.",
        );
        return;
      }
      streamOwnsCaptureRef.current = true;
      // Set srcObject directly so the video starts before the canvas-ready poll.
      // The useEffect([stream]) guard (srcObject !== stream) prevents a second
      // assignment when React later commits the setStream state update — that
      // double-assignment would tear down the WGC texture handle.
      if (videoRef.current && videoRef.current.srcObject !== activeStream) {
        videoRef.current.srcObject = activeStream;
        videoRef.current.play().catch(() => {});
      }
      // Still yield so React can commit setStream (needed for stream-dependent
      // code elsewhere in the component, e.g. the compositor activation effect).
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }

    // Kick the compositor loop so it starts compositing and sizes the canvas to
    // the real capture resolution. The isStreaming effect also activates it, but
    // we start it here so the canvas is sized before we configure the encoder.
    compositorActiveRef.current = true;
    if (cardRequestRef.current === null) {
      cardRequestRef.current = requestAnimationFrame(renderCardCompositor);
    }

    // Determine encoder dimensions. For fixed presets (1080p, 720p, etc.) we
    // know the target immediately — no need to wait for the video element.
    // For "original" we need the actual video dimensions: poll for up to 5s.
    // Either way we explicitly size the canvas so the compositor loop is never
    // given a mismatched frame (avoids the old circular dependency where the
    // compositor refused to size the canvas until readyState>=2, while the
    // canvas-ready poll was waiting for the compositor to size it).
    let encW: number;
    let encH: number;
    if (activePreset.width > 0 && activePreset.height > 0) {
      encW = activePreset.width;
      encH = activePreset.height;
    } else {
      const dims = await new Promise<{ w: number; h: number }>((resolve) => {
        const deadline = performance.now() + 5000;
        const poll = () => {
          const v = videoRef.current;
          if (v && v.videoWidth > 0 && v.videoHeight > 0) {
            resolve({ w: v.videoWidth, h: v.videoHeight });
          } else if (performance.now() >= deadline) {
            console.warn(
              "[TargetOutputNode] Video dimensions not available — falling back to 1280x720",
            );
            resolve({ w: 1280, h: 720 });
          } else {
            requestAnimationFrame(poll);
          }
        };
        poll();
      });
      encW = dims.w;
      encH = dims.h;
    }
    // H.264 (yuv420p) requires even dimensions.
    const encWidth = encW - (encW % 2);
    const encHeight = encH - (encH % 2);
    // Force the canvas to encoder dims now so every frame the compositor
    // submits is the right size from the very first encoded frame.
    canvas.width = encWidth;
    canvas.height = encHeight;

    const streamFps = settings.streamFps ?? 30;
    const frameDurationMs = 1000 / streamFps;
    const bitrateKbps = settings.streamBitrateKbps || 6000;

    // ── Preferred: WebCodecs hardware H.264 → FFmpeg copy-mux ─────────────────
    console.log(
      `[TargetOutputNode] Configuring encoder at ${encWidth}x${encHeight}`,
    );
    const encoderHandle = await createH264CanvasEncoder({
      width: encWidth,
      height: encHeight,
      fps: streamFps,
      bitrateKbps,
      onChunk: (buffer) => window.electron.pushStreamData(buffer),
      onError: (err) => console.error("[TargetOutputNode] H.264 encoder:", err),
    });

    if (encoderHandle) {
      console.log(
        `[TargetOutputNode] WebCodecs H.264 (${encoderHandle.codec}) at ${canvas.width}x${canvas.height} ${streamFps}fps → FFmpeg copy-mux`,
      );
      try {
        const initRes = await window.electron.startStream(rtmpUrl, {
          mode: "h264",
          fps: streamFps,
          bitrateKbps,
          streamDelayMs: settings.streamDelayMs ?? 0,
        });
        if (!initRes.success) {
          console.error(
            "[TargetOutputNode] Failed to initialize FFmpeg muxer.",
          );
          await encoderHandle.close();
          return;
        }
      } catch (err) {
        console.error("[TargetOutputNode] Failed to start stream:", err);
        await encoderHandle.close();
        return;
      }

      // Drive encoding from the single compositor loop (renderCardCompositor)
      // rather than a second rAF loop — one composite+encode per frame, no
      // contention. The compositor reads these refs each frame.
      h264EncoderRef.current = encoderHandle;
      streamFpsRef.current = streamFps;
      streamFrameIndexRef.current = 0;
      streamDimsRef.current = { width: encWidth, height: encHeight };
      isStreamingRef.current = true;

      setIsStreaming(true);
      setShowStreamInput(false);
      return;
    }

    // ── Fallback: canvas → JPEG → FFmpeg transcode ────────────────────────────
    console.warn(
      "[TargetOutputNode] WebCodecs H.264 unavailable — falling back to JPEG transcode pipeline.",
    );

    // Cap the compositor to the stream fps too (encode block stays inert here
    // since h264EncoderRef is null — the JPEG captureLoop does the work).
    streamFpsRef.current = streamFps;
    streamDimsRef.current = { width: canvas.width, height: canvas.height };
    isStreamingRef.current = true;

    const presetW =
      typeof activePreset.width === "number" && activePreset.width > 0
        ? activePreset.width
        : null;
    const presetH =
      typeof activePreset.height === "number" && activePreset.height > 0
        ? activePreset.height
        : null;

    try {
      const initRes = await window.electron.startStream(rtmpUrl, {
        mode: "mjpeg",
        encoder: settings.streamEncoder || "libx264",
        bitrateKbps,
        fps: streamFps,
        streamDelayMs: settings.streamDelayMs ?? 0,
        ...(presetW && presetH ? { width: presetW, height: presetH } : {}),
      });
      if (!initRes.success) {
        console.error("[TargetOutputNode] Failed to initialize FFmpeg stream.");
        return;
      }
    } catch (err) {
      console.error("[TargetOutputNode] Failed to start stream:", err);
      return;
    }

    let lastFrameTime = 0;
    let capturing = false;

    const captureLoop = (now: number) => {
      if (!frameIntervalRef.current) return;

      frameIntervalRef.current = requestAnimationFrame(captureLoop) as any;

      // Rate-limit to target fps (more precise than setInterval on Windows)
      if (now - lastFrameTime < frameDurationMs) return;
      lastFrameTime = now;

      if (capturing) return; // skip if previous encode still in flight
      capturing = true;

      canvas.toBlob(
        (blob) => {
          capturing = false;
          if (blob && blob.size > 0) {
            blob.arrayBuffer().then((buffer) => {
              window.electron.pushStreamData(buffer);
            });
          }
        },
        "image/jpeg",
        0.92, // Higher quality reduces generation loss when FFmpeg re-encodes
      );
    };

    frameIntervalRef.current = requestAnimationFrame(captureLoop) as any;

    setIsStreaming(true);
    setShowStreamInput(false);
  }, [
    stream,
    rtmpUrl,
    captureSourceId,
    captureAudio,
    captureFrameRate,
    activePreset,
    nativeCaptureDims,
    startCapture,
    renderCardCompositor,
    settings.streamEncoder,
    settings.streamBitrateKbps,
    settings.streamFps,
    settings.streamDelayMs,
  ]);

  const stopStreaming = useCallback(async () => {
    // Stop the compositor from feeding new frames to the encoder
    isStreamingRef.current = false;
    streamDimsRef.current = null;
    // Stop the JPEG fallback rAF loop, if it was running
    if (frameIntervalRef.current !== null) {
      cancelAnimationFrame(frameIntervalRef.current as unknown as number);
      frameIntervalRef.current = null;
    }
    // Flush + release the WebCodecs encoder (drains remaining frames to FFmpeg)
    if (h264EncoderRef.current) {
      await h264EncoderRef.current.close();
      h264EncoderRef.current = null;
    }
    await window.electron.stopStream();
    setIsStreaming(false);
    // If streaming auto-started the capture (preview wasn't open), stop it now
    if (streamOwnsCaptureRef.current && !isPreviewActive) {
      stopCapture();
      streamOwnsCaptureRef.current = false;
    }
  }, [isPreviewActive, stopCapture]);

  // Subscribe to live FFmpeg stream stats while streaming is active
  useEffect(() => {
    if (!isStreaming) {
      setStreamStats(null);
      return;
    }
    window.electron.onStreamStatus((stats) => {
      setStreamStats(stats);
    });
    return () => {
      window.electron.removeOnStreamStatus();
    };
  }, [isStreaming]);

  // Clean up recording if preview is toggled off.
  // Streaming is NOT stopped here — it manages its own capture lifecycle.
  useEffect(() => {
    if (!isPreviewActive || !stream) {
      if (isRecording) stopRecording();
    }
  }, [isPreviewActive, stream, isRecording, stopRecording]);

  return (
    <>
      <BaseNodeCard
        id={node.id}
        selected={node.selected}
        isMinimized={!!node.data.isMinimized}
        borderColor="red"
        iconColor="red"
        icon={MonitorIcon}
        title="Compositor Output"
        subtitle="Composite, record & stream"
        anchorName={`--targetOutputNode_${node.id}`}
      >
        {/* Sourrce Handle label */}
        <div className="left-3.5 text-[9px] font-bold text-zinc-500 uppercase tracking-wider pointer-events-none select-none">
          Source
        </div>
        <div className="left-3.5 text-[9px] font-bold text-zinc-500 uppercase tracking-wider pointer-events-none select-none">
          Overlays
        </div>

        {/* Live Video Preview Area */}
        <div className="flex flex-col gap-1.5 nodrag nopan nowheel">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
              Overlay
            </label>
            {captureSourceId && (
              <div className="flex items-center gap-1.5">
                <button
                  onClick={handleTogglePreview}
                  className={cn(
                    "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-all font-semibold uppercase tracking-wider cursor-pointer",
                    isPreviewActive
                      ? "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                      : "bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 hover:bg-indigo-500/20",
                  )}
                >
                  {isPreviewActive ? (
                    <>
                      <ScanEyeIcon className="w-2.5 h-2.5 fill-current border-accent" />{" "}
                      Stop
                    </>
                  ) : (
                    <>
                      <ScanEyeIcon className="w-2.5 h-2.5 fill-current" />{" "}
                      Preview
                    </>
                  )}
                </button>

                <button
                  onClick={() => {
                    void handleEditOverlay();
                  }}
                  className={cn(
                    "flex items-center gap-1 text-[10px] px-2 py-0.5 rounded transition-all font-semibold uppercase tracking-wider cursor-pointer",
                    editOverlayOpen
                      ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/30"
                      : "bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-zinc-300 hover:text-white",
                  )}
                  title="Open overlay editor in a separate window"
                >
                  <SquareDashedMousePointer className="w-3 h-3" /> Edit
                </button>
              </div>
            )}
          </div>

          {/* Fit mode — how the source is mapped into a differently-shaped output */}
          {captureSourceId && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wider">
                Fit
              </span>
              <div className="flex items-center gap-0.5 rounded-md bg-zinc-900 border border-zinc-800 p-0.5">
                {(
                  [
                    ["contain", "Fit"],
                    ["cover", "Fill"],
                    ["stretch", "Stretch"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    onClick={() => setFitMode(mode)}
                    title={
                      mode === "contain"
                        ? "Letterbox — show everything, black bars"
                        : mode === "cover"
                          ? "Crop to fill — no bars, edges cropped"
                          : "Stretch to fill — distorts aspect ratio"
                    }
                    className={cn(
                      "px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider transition-colors cursor-pointer",
                      fitMode === mode
                        ? "bg-indigo-500/20 text-indigo-300"
                        : "text-zinc-500 hover:text-zinc-300",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div
            className="relative rounded-lg border border-zinc-800 overflow-hidden bg-black flex flex-col items-center justify-center shadow-inner group transition-all duration-300"
            style={{
              aspectRatio:
                activePreset.aspect === "auto"
                  ? dynamicAspectRatio
                  : activePreset.aspect,
            }}
          >
            {/* Offscreen video + canvas: always mounted when a source is connected so
                 canvasRef is available for streaming even without preview active */}
            {captureSourceId && (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={handleVideoLoadedMetadata}
                  style={{
                    position: "absolute",
                    width: "1px",
                    height: "1px",
                    opacity: 0,
                    pointerEvents: "none",
                  }}
                />
                <canvas
                  ref={canvasRef}
                  className="w-full h-full object-contain"
                  style={{
                    // Only show canvas visually when preview is explicitly enabled.
                    // Streaming uses the canvas via captureStream() even when hidden.
                    display: isPreviewActive && stream ? "block" : "none",
                  }}
                />
              </>
            )}
            {!(isPreviewActive && stream) && !isStreaming && (
              <div className="flex flex-col items-center gap-2 text-zinc-500 text-center px-4 py-8">
                <MonitorIcon className="w-8 h-8 text-zinc-700 stroke-[1.5]" />
                <span className="text-[10px]">
                  {!captureSourceId
                    ? "Connect Capture Source Node"
                    : isPreviewActive
                      ? "Initialising compositor..."
                      : "Click Preview to test output"}
                </span>
              </div>
            )}
          </div>

          {/* Record / Stream controls — visible whenever a capture source is connected */}
          {captureSourceId && (
            <div className="flex items-center gap-2 justify-between mt-1">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={!isPreviewActive || !stream}
                title={
                  !isPreviewActive || !stream
                    ? "Enable Preview to record"
                    : undefined
                }
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider border transition-all",
                  isRecording
                    ? "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 animate-pulse cursor-pointer"
                    : !isPreviewActive || !stream
                      ? "bg-zinc-900/50 text-zinc-600 border-zinc-800/50 cursor-not-allowed"
                      : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-white cursor-pointer",
                )}
              >
                {isRecording ? (
                  <>
                    <SquareIcon className="w-2.5 h-2.5 fill-current" /> Stop Rec
                  </>
                ) : (
                  <>
                    <DiscIcon className="w-2.5 h-2.5" /> Record
                  </>
                )}
              </button>

              <button
                onClick={
                  isStreaming
                    ? stopStreaming
                    : () => setShowStreamInput(!showStreamInput)
                }
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider cursor-pointer border transition-all",
                  isStreaming
                    ? "bg-purple-500/10 text-purple-400 border-purple-500/20 hover:bg-purple-500/20 animate-pulse"
                    : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-white",
                )}
              >
                {isStreaming ? (
                  <>
                    <SquareIcon className="w-2.5 h-2.5 fill-current" /> End
                    Stream
                  </>
                ) : (
                  <>
                    <RadioIcon className="w-2.5 h-2.5" /> Start Stream
                  </>
                )}
              </button>
            </div>
          )}

          {showStreamInput && !isStreaming && (
            <div className="flex flex-col gap-2 p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg mt-1 text-[11px]">
              {/* RTMP URL */}
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold text-zinc-200">
                  RTMP Target URL
                </span>
                <span className="text-[9px] text-zinc-500">
                  Server URL + stream key combined, or enter separately below
                </span>
              </div>
              <input
                type="text"
                value={settings.streamUrl || ""}
                onChange={(e) =>
                  updateSettings({ streamUrl: cleanStreamUrl(e.target.value) })
                }
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                placeholder="rtmp://..."
              />
              {rtmpUrl &&
                !rtmpUrl.startsWith("rtmp://") &&
                !rtmpUrl.startsWith("rtmps://") && (
                  <span className="text-[10px] text-amber-500 font-semibold mt-0.5">
                    Warning: Stream URL should start with rtmp:// or rtmps://
                  </span>
                )}

              {/* Stream Key (optional — appended to base URL) */}
              <div className="flex flex-col gap-1 mt-1">
                <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                  Stream Key
                </span>
                <input
                  type="password"
                  value={settings.streamToken || ""}
                  onChange={(e) =>
                    updateSettings({ streamToken: e.target.value })
                  }
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none font-mono"
                  placeholder="Enter stream key (optional)..."
                />
              </div>

              {/* Bitrate + FPS + Encoder */}
              <div className="flex gap-2 mt-1">
                <div className="flex flex-col gap-1 flex-1">
                  <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                    Bitrate (Kbps)
                  </span>
                  <input
                    type="number"
                    value={settings.streamBitrateKbps ?? 6000}
                    onChange={(e) => {
                      const val = parseInt(e.target.value, 10);
                      updateSettings({
                        streamBitrateKbps: isNaN(val) ? undefined : val,
                      });
                    }}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none font-mono"
                    placeholder="6000"
                    min={500}
                    max={51000}
                    step={500}
                  />
                </div>
                <div className="flex flex-col gap-1 w-16 shrink-0">
                  <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                    FPS
                  </span>
                  <select
                    value={settings.streamFps ?? 30}
                    onChange={(e) =>
                      updateSettings({
                        streamFps: Number(e.target.value) as 30 | 60,
                      })
                    }
                    className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none cursor-pointer"
                  >
                    <option value={30}>30</option>
                    <option value={60}>60</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1 flex-1">
                  <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                    Encoder
                  </span>
                  <select
                    value={settings.streamEncoder || "copy"}
                    onChange={(e) =>
                      updateSettings({ streamEncoder: e.target.value as "copy" | "libx264" | "h264_nvenc" | "h264_amf" | "h264_qsv" })
                    }
                    className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none cursor-pointer"
                  >
                    <option value="copy">Auto (WebCodecs)</option>
                    <option value="libx264">CPU (x264)</option>
                    <option value="h264_nvenc">NVIDIA (NVENC)</option>
                    <option value="h264_amf">AMD (AMF)</option>
                    <option value="h264_qsv">Intel (QSV)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1 w-16 shrink-0">
                  <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                    Delay
                  </span>
                  <select
                    value={settings.streamDelayMs ?? 0}
                    onChange={(e) =>
                      updateSettings({
                        streamDelayMs: Number(e.target.value),
                      })
                    }
                    className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none cursor-pointer"
                  >
                    <option value={0}>None</option>
                    <option value={5000}>5s</option>
                    <option value={10000}>10s</option>
                    <option value={15000}>15s</option>
                  </select>
                </div>
              </div>

              {!isPreviewActive && (
                <span className="text-[9px] text-zinc-500 mt-0.5">
                  Preview will start automatically when streaming begins.
                </span>
              )}
              <div className="flex gap-2 justify-end mt-1">
                <button
                  onClick={() => setShowStreamInput(false)}
                  className="text-[10px] text-zinc-400 hover:text-zinc-200 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={startStreaming}
                  className="text-[10px] px-2 py-0.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium cursor-pointer"
                >
                  Start Stream
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Node status / info */}
        <div className="text-[10px] text-zinc-500 border-t border-zinc-800/80 pt-3 flex flex-col gap-1">
          <div>Connected overlays: {overlays.length}</div>
          {sourceNode ? (
            <div className="text-zinc-400">
              Source:{" "}
              <span className="text-indigo-400 font-semibold">
                {sourceNode.data.captureSourceName || "unnamed"}
              </span>
            </div>
          ) : (
            <div className="text-yellow-500/80">
              Missing Capture Source input connection
            </div>
          )}
        </div>

        {/* Live stream stats bar */}
        {isStreaming && streamStats && (
          <div className="flex flex-col gap-1.5 nodrag nopan nowheel">
            <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
              Stream statistics
            </label>
            <div className="flex items-center gap-2 justify-between mt-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5 px-2 py-1.5 bg-zinc-950 border border-purple-500/20 rounded-lg text-[9px] font-mono">
                <span className="text-zinc-500 font-sans font-semibold uppercase tracking-wider text-[8px]">
                  Live
                </span>
                {streamStats.fps !== null && (
                  <span
                    className={cn(
                      "font-semibold",
                      streamStats.fps >= 25
                        ? "text-emerald-400"
                        : streamStats.fps >= 15
                          ? "text-amber-400"
                          : "text-red-400",
                    )}
                  >
                    {streamStats.fps.toFixed(1)} fps
                  </span>
                )}
                {streamStats.bitrate && (
                  <span className="text-zinc-300">{streamStats.bitrate}</span>
                )}
                {streamStats.speed && (
                  <span
                    className={cn(
                      streamStats.speed && parseFloat(streamStats.speed) >= 0.9
                        ? "text-emerald-400"
                        : streamStats.speed &&
                            parseFloat(streamStats.speed) >= 0.5
                          ? "text-amber-400"
                          : "text-red-400",
                    )}
                  >
                    {streamStats.speed}
                  </span>
                )}
                {streamStats.dropped !== null && streamStats.dropped > 0 && (
                  <span className="text-red-400">
                    ⚠ {streamStats.dropped} dropped
                  </span>
                )}
                {streamStats.time && (
                  <span className="text-zinc-500 ml-auto">
                    {streamStats.time}
                  </span>
                )}
              </div>
            </div>
          </div>
        )}
      </BaseNodeCard>

      {/* Target input handles */}
      <Handle
        id={`handle_${node.id}_source_target`}
        type="target"
        position={Position.Left}
        isConnectable={node.isConnectable}
        isValidConnection={isValidSourceConnection}
        style={{ top: "78px" }}
        className="hover:!border-red-400 hover:!shadow-[0_0_10px_rgba(248,113,113,0.5)] hover:!scale-125"
      />
      <Handle
        id={`handle_${node.id}_overlay_target`}
        type="target"
        position={Position.Left}
        isConnectable={node.isConnectable}
        isValidConnection={isValidOverlayConnection}
        style={{ top: "107px" }}
        className="hover:!border-red-400 hover:!shadow-[0_0_10px_rgba(248,113,113,0.5)] hover:!scale-125"
      />

      <StatusDialog
        status={editOverlayDialogStatus}
        progress={editOverlayDialogProgress}
        title="Opening Overlay Editor"
      />
    </>
  );
}
export default TargetOutputNode;
