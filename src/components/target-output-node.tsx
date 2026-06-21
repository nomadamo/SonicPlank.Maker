import { BaseNodeCard, showToast } from "./base-node";
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
  ChevronDown as ChevronDownIcon,
} from "lucide-react";
import { FlowNodeType, OverlayElement } from "@/types/flow-node";
import { chatMessagesStore, type ChatMessage } from "@/store/chatMessagesStore";
import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useNativePreview } from "@/hooks/useNativePreview";
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

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxW: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current !== "" && ctx.measureText(candidate).width > maxW) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

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
    Map<
      string,
      {
        canvas: OffscreenCanvas;
        ctx2d: OffscreenCanvasRenderingContext2D;
        lastDrawn: number;
        dataArray: Uint8Array<ArrayBuffer>;
        broadcastArray: number[];
        barsGrad: CanvasGradient | null;
        barsGradH: number;
      }
    >
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
  const targetId = (node.data.streamTargetId as string) || (settings.rtmpTargets?.[0]?.id || "");
  const configType = (node.data.streamConfigType as "global" | "custom") || "global";
  const customConfig = (node.data.streamCustomConfig as any) || {
    streamFps: settings.streamFps || 60,
    streamEncoder: settings.streamEncoder || "copy",
    streamDelayMs: settings.streamDelayMs || 0,
    streamBitrateKbps: settings.streamBitrateKbps || 6000,
  };

  const updateNodeDataField = useCallback((field: string, value: any) => {
    updateNodeData({
      id: node.id,
      patch: { [field]: value },
    });
  }, [node.id, updateNodeData]);
  const [showStreamInput, setShowStreamInput] = useState(false);
  const [streamStats, setStreamStats] = useState<StreamStats | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [statsExpanded, setStatsExpanded] = useState(false);
  // rAF handle for the JPEG fallback capture loop (non-null = fallback streaming active)
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Active WebCodecs encoder handle (null when falling back to the JPEG path)
  const h264EncoderRef = useRef<H264EncoderHandle | null>(null);
  // WebCodecs streaming state, held in refs so the compositor loop can encode
  // each composited frame without re-creating the render callback.
  const isStreamingRef = useRef<boolean>(false);
  const streamFpsRef = useRef<number>(60);
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
  const {
    canvasesRef: nativePreviewCanvasesRef,
    startCapture: startNativePreviewCapture,
    stopCapture: stopNativePreviewCapture,
  } = useNativePreview();

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

  // Capture Source directly connected to this node's source handle (legacy / single-source fallback)
  const directSourceNode = useMemo(() => {
    const sourceEdge = edges.find(
      (e) =>
        e.target === node.id &&
        e.targetHandle === `handle_${node.id}_source_target`,
    );
    if (!sourceEdge) return null;
    return (
      (nodes.find(
        (n) => n.id === sourceEdge.source && n.type === "captureSourceNode",
      ) as FlowNodeType) || null
    );
  }, [edges, nodes, node.id]);

  // Overlay Compositor node — may carry capture source role config
  const connectedOverlayGroupNode = useMemo(() => {
    const overlayEdge = edges.find(
      (e) =>
        e.target === node.id &&
        e.targetHandle === `handle_${node.id}_overlay_target`,
    );
    if (!overlayEdge) return null;
    return (
      (nodes.find(
        (n) => n.id === overlayEdge.source && n.type === "overlayGroupNode",
      ) as FlowNodeType) || null
    );
  }, [edges, nodes, node.id]);

  // Resolve the primary capture source: prefer the source marked "primary" in the
  // Overlay Compositor's sourceRoles config; fall back to the direct connection.
  const sourceNode = useMemo(() => {
    if (connectedOverlayGroupNode) {
      const storedRoles =
        (connectedOverlayGroupNode.data.sourceRoles as Record<
          string,
          { role: string }
        >) || {};
      const groupSources = edges
        .filter((e) => e.target === connectedOverlayGroupNode.id)
        .map((e) =>
          nodes.find((n) => n.id === e.source && n.type === "captureSourceNode"),
        )
        .filter(Boolean) as FlowNodeType[];
      if (groupSources.length > 0) {
        return (
          groupSources.find((s) => storedRoles[s.id]?.role === "primary") ||
          groupSources[0]
        );
      }
    }
    return directSourceNode;
  }, [edges, nodes, connectedOverlayGroupNode, directSourceNode]);

  const activeStreamSources = useMemo(() => {
    const streamSources: {
      node_id: string;
      source_id: string;
      is_primary: boolean;
      x_percent: number;
      y_percent: number;
      w_percent: number;
      h_percent: number;
    }[] = [];

    // The primary source is always the direct capture source if there is one
    const primarySourceId = directSourceNode?.data.captureSourceId as string | undefined;

    if (primarySourceId) {
      streamSources.push({
        node_id: directSourceNode!.id,
        source_id: primarySourceId,
        is_primary: true,
        x_percent: 0,
        y_percent: 0,
        w_percent: 100,
        h_percent: 100,
      });
    }

    if (connectedOverlayGroupNode) {
      const storedRoles =
        (connectedOverlayGroupNode.data.sourceRoles as Record<
          string,
          { role: string; pipX: number; pipY: number; pipW: number; pipH: number }
        >) || {};
      const groupSources = edges
        .filter((e) => e.target === connectedOverlayGroupNode.id)
        .map((e) =>
          nodes.find((n) => n.id === e.source && n.type === "captureSourceNode"),
        )
        .filter(Boolean) as FlowNodeType[];

      let hasPrimary = !!primarySourceId;

      for (const s of groupSources) {
        const sid = s.data.captureSourceId as string;
        if (!sid) continue;

        // If this source is already added as the primary, skip adding it again as a PiP
        if (sid === primarySourceId) {
          continue;
        }
        
        const r = storedRoles[s.id];
        if (r) {
          const isPrimary = !hasPrimary && r.role === "primary";
          if (isPrimary) hasPrimary = true;
          streamSources.push({
            node_id: s.id,
            source_id: sid,
            is_primary: isPrimary,
            x_percent: r.pipX ?? 0,
            y_percent: r.pipY ?? 0,
            w_percent: r.pipW ?? 100,
            h_percent: r.pipH ?? 100,
          });
        } else {
          streamSources.push({
            node_id: s.id,
            source_id: sid,
            is_primary: !hasPrimary,
            x_percent: 70,
            y_percent: 70,
            w_percent: 25,
            h_percent: 14,
          });
          hasPrimary = true;
        }
      }
    }

    return streamSources;
  }, [edges, nodes, connectedOverlayGroupNode, directSourceNode]);

  // Keep the Rust core's compositor config in sync with the current UI layout
  const prevCoreConfigRef = useRef("");
  useEffect(() => {
    const configStr = JSON.stringify(activeStreamSources);
    if (prevCoreConfigRef.current !== configStr) {
      prevCoreConfigRef.current = configStr;
      window.electron.setCoreConfig(activeStreamSources).catch(console.error);
    }
  }, [activeStreamSources]);

  // Extract source parameters
  const captureSourceId = sourceNode?.data.captureSourceId;
  const captureAudio = !!sourceNode?.data.captureAudio;
  const captureResolution = sourceNode?.data.captureResolution || "original";
  const captureFrameRate = Number(sourceNode?.data.maxCaptureFrameRate) || 60;

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
    const isScreenSource = captureSourceId?.startsWith("screen:");
    const isMonitorSource = captureSourceId?.startsWith("monitor:");
    if ((isScreenSource || isMonitorSource) && displays.length > 0) {
      let activeDisplay: any = null;
      if (isMonitorSource) {
        const index = parseInt(captureSourceId!.replace("monitor:", ""), 10);
        activeDisplay =
          !isNaN(index) && index >= 0 && index < displays.length
            ? displays[index]
            : (displays.find((d: any) => d.isPrimary) ?? displays[0]);
      } else {
        const idStr = captureSourceId!.replace("screen:", "");
        activeDisplay =
          displays.find((d) => String(d.id) === idStr) ||
          displays.find((d) => d.isPrimary) ||
          displays[0];
      }
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
  const fitModeRef = useRef(fitMode);
  fitModeRef.current = fitMode;

  const setFitMode = useCallback(
    (mode: "contain" | "cover" | "stretch") => {
      updateNodeData({ id: node.id, patch: { fitMode: mode } });
    },
    [updateNodeData, node.id],
  );

  useEffect(() => {
    window.electron.updateFitMode(fitMode).catch(() => {});
  }, [fitMode]);

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

  // Keep the offscreen overlay window's resolution in sync with the primary native capture
  // so that percentage-based overlays are composited correctly by the Rust core.
  useEffect(() => {
    if (nativeCaptureDims.width > 0 && nativeCaptureDims.height > 0) {
      window.electron.setOverlayResolution(nativeCaptureDims.width, nativeCaptureDims.height).catch(console.error);
    }
  }, [nativeCaptureDims.width, nativeCaptureDims.height]);

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
              "twitchChatNode",
            ].includes(n.type || "")
          ),
      )
      .sort((a, b) => a.position.y - b.position.y);

    const list: OverlayElement[] = [];
    overlayNodes.forEach((n) => {
      const type = (
        n.type === "nowPlayingNode"
          ? "nowPlaying"
          : n.type === "twitchChatNode"
            ? "twitchChat"
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
            (an) => an.id === audioEdge.source && (an.type === "audioFlowNode" || an.type === "globalAudioNode"),
          );
          if (audioNode) {
            if (audioNode.type === "audioFlowNode") {
              albumArt = (audioNode.data.albumArt as string) || "";
              title = (audioNode.data.title as string) || "Unknown Title";
              artist = (audioNode.data.artist as string) || "Unknown Artist";
              audioNodeId = audioNode.id;
              duration = Number(audioNode.data.duration) || 0;
            } else if (audioNode.type === "globalAudioNode") {
              albumArt = (audioNode.data.albumArt as string) || "";
              title = (audioNode.data.title as string) || "Global Audio";
              artist = (audioNode.data.artist as string) || "Unknown";
              audioNodeId = audioNode.id;
              duration = Number(audioNode.data.duration) || 0;
            }
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
        maxMessages:
          data.maxMessages !== undefined ? Number(data.maxMessages) : 10,
      });
    });

    // Inject PiP pseudo-overlays for the overlay editor
    if (connectedOverlayGroupNode) {
      activeStreamSources.forEach((src) => {
        if (!src.is_primary) {
          list.push({
            id: `pip::${connectedOverlayGroupNode.id}::${src.node_id}`,
            type: "pip" as any,
            x: src.x_percent,
            y: src.y_percent,
            width: src.w_percent,
            height: src.h_percent,
            opacity: 1,
            textContent: "",
            fontSize: 0,
            textColor: "",
            backgroundColor: "",
            imagePath: "",
            visualizerType: "",
            fontFamily: "",
            fontWeight: "",
            fontStyle: "",
            albumArt: "",
            title: "",
            artist: "",
            audioNodeId: "",
            duration: 0,
            maxMessages: 0,
          });
        }
      });
    }

    return list;
  }, [edges, nodes, connectedOverlayGroupNode, activeStreamSources]);

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
    sourceIds: string;
    audio: boolean;
    width: number;
    height: number;
  } | null>(null);

  const previewSourceIdsStr = useMemo(() => activeStreamSources.map(s => s.source_id).join(","), [activeStreamSources]);

  useEffect(() => {
    if (isPreviewActive || editOverlayOpen) {
      const currentParams = {
        sourceIds: previewSourceIdsStr,
        audio: captureAudio,
        width: nativeCaptureDims.width,
        height: nativeCaptureDims.height,
      };

      const hasChanged =
        !lastCaptureParamsRef.current ||
        lastCaptureParamsRef.current.sourceIds !== currentParams.sourceIds ||
        lastCaptureParamsRef.current.audio !== currentParams.audio ||
        lastCaptureParamsRef.current.width !== currentParams.width ||
        lastCaptureParamsRef.current.height !== currentParams.height;

      if (hasChanged) {
        console.log(
          `[TargetOutputNode] Starting/restarting native stream with targets: ${previewSourceIdsStr}`,
        );
        lastCaptureParamsRef.current = currentParams;
        startNativePreviewCapture(activeStreamSources.map(s => s.source_id)).catch(console.error);
      }
    } else {
      if (lastCaptureParamsRef.current) {
        stopNativePreviewCapture().catch(console.error);
        lastCaptureParamsRef.current = null;
      }
    }
  }, [
    previewSourceIdsStr,
    activeStreamSources,
    captureAudio,
    captureFrameRate,
    nativeCaptureDims.width,
    nativeCaptureDims.height,
    isPreviewActive,
    editOverlayOpen,
    startNativePreviewCapture,
    setIsPreviewActive,
  ]);

  // Handle stream assignment to HTMLVideoElement.
  // Guard against double-assignment: startStreaming sets srcObject directly so
  // the video is ready before the canvas-ready poll starts. Without the guard
  // a second assignment (with the same MediaStream object) would tear down the
  // WGC texture handle and break capture.

  // Audio stream is now handled by the native compositor/audio nodes

  // Compositor canvas render loop
  const renderCardCompositor = useCallback(() => {
    if (!compositorActiveRef.current) {
      cardRequestRef.current = null;
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      cardRequestRef.current = requestAnimationFrame(renderCardCompositor);
      return;
    }

    // Read the single preview feed generated by Core
    const srcCanvas = nativePreviewCanvasesRef.current.get("preview");
    if (!srcCanvas || srcCanvas.width === 0 || srcCanvas.height === 0) {
      cardRequestRef.current = requestAnimationFrame(renderCardCompositor);
      return;
    }

    const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true });
    if (!ctx) {
      cardRequestRef.current = requestAnimationFrame(renderCardCompositor);
      return;
    }

    // Set size to match the incoming preview
    if (canvas.width !== srcCanvas.width || canvas.height !== srcCanvas.height) {
      canvas.width = srcCanvas.width;
      canvas.height = srcCanvas.height;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(srcCanvas, 0, 0, canvas.width, canvas.height);

    // Forward the frame to the Edit Overlay window if open.
    // Core sends the preview scaled/optimised, so we can just send it as-is.
    if (editOverlayOpenRef.current && !previewCapturePendingRef.current) {
      const now = performance.now();
      if (now - lastPreviewBroadcastRef.current >= 100) {
        lastPreviewBroadcastRef.current = now;
        previewCapturePendingRef.current = true;
        
        canvas.toBlob((blob) => {
          previewCapturePendingRef.current = false;
          if (!blob || !editOverlayOpenRef.current) return;
          blob.arrayBuffer().then((buf) => {
            if (editOverlayOpenRef.current) {
              window.electron.sendPreviewFrame(buf, canvas.width, canvas.height);
            }
          }).catch(() => {});
        }, "image/jpeg", 0.7);
      }
    }

    cardRequestRef.current = requestAnimationFrame(renderCardCompositor);
  }, []);

  // Handle compositor loop activation --- runs when preview, streaming, or edit overlay is active
  useEffect(() => {
    if (isPreviewActive || isStreaming || editOverlayOpen) {
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
  }, [isPreviewActive, isStreaming, editOverlayOpen, renderCardCompositor]);

  const handleEditOverlay = useCallback(async () => {
    if (!captureSourceId) return;
    setEditOverlayDialogStatus("running");
    setEditOverlayDialogProgress(33);
    setEditOverlayOpen(true);
    const aspect =
      activePreset.aspect === "auto" ? "auto" : activePreset.aspect;
    await window.electron.openEditOverlay({ aspect, fitMode });
    window.electron.notifyEditOverlayConnected();
  }, [captureSourceId, activePreset.aspect, fitMode]);

  // When the Edit Overlay window is closed externally, clean up
  useEffect(() => {
    window.electron.onEditOverlayClosed(() => {
      setEditOverlayOpen(false);
      setEditOverlayDialogStatus("idle");
      setEditOverlayDialogProgress(0);
      previewCapturePendingRef.current = false;
    });
    return () => {
      window.electron.removeOnEditOverlayClosed();
    };
  }, [stopNativePreviewCapture]);

  // Advance dialog to 66% when stream becomes ready, then listen for first frame confirmation
  useEffect(() => {
    if (editOverlayOpen) {
      setEditOverlayDialogProgress(66);
    }
  }, [editOverlayOpen]);

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
      setIsPreviewActive(false);
    } else {
      if (activeStreamSources.length === 0) return;
      setIsPreviewActive(true);
    }
  }, [
    isPreviewActive,
    activeStreamSources,
    setIsPreviewActive,
    stopNativePreviewCapture,
    startNativePreviewCapture,
  ]);

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
      ? (canvas as any).captureStream(settings.streamFps ?? 60)
      : (canvas as any).captureStream
        ? (canvas as any).captureStream(settings.streamFps ?? 60)
        : null;

    if (!streamToRecord) {
      console.error("Canvas captureStream is not supported.");
      return;
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
  }, [
    settings.recordingBitrateKbps,
    settings.recordingPath,
    settings.streamFps,
  ]);

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
    const target = settings.rtmpTargets?.find((t) => t.id === targetId);
    if (!target || !target.url || !captureSourceId) return;

    const base = target.url.trim();
    const token = target.key.trim();
    const resolvedRtmpUrl = base.endsWith("/") ? `${base}${token}` : `${base}/${token}`;

    const isCustom = configType === "custom";
    const finalFps = isCustom ? customConfig.streamFps : settings.streamFps || 60;
    const finalEncoder = isCustom ? customConfig.streamEncoder : settings.streamEncoder || "copy";
    const finalDelay = isCustom ? customConfig.streamDelayMs : settings.streamDelayMs || 0;
    const finalBitrate = isCustom ? customConfig.streamBitrateKbps : settings.streamBitrateKbps || 6000;

    setIsStarting(true);
    try {
      // ── Native WGC path — bypass Chromium capture + WebCodecs entirely ─────────
      if (
        captureSourceId.startsWith("monitor:") ||
        captureSourceId.startsWith("window:")
      ) {
        const streamFps = finalFps;
        const presetW =
          typeof activePreset.width === "number" && activePreset.width > 0
            ? activePreset.width
            : undefined;
        const presetH =
          typeof activePreset.height === "number" && activePreset.height > 0
            ? activePreset.height
            : undefined;
        const streamSources = activeStreamSources.map((s) => ({
          source_id: s.source_id,
          is_primary: s.is_primary,
          x_percent: s.x_percent,
          y_percent: s.y_percent,
          w_percent: s.w_percent,
          h_percent: s.h_percent,
        }));

        try {
          await window.electron.startNativeStream({
            rtmpUrl: resolvedRtmpUrl,
            fps: finalFps,
            outputWidth: presetW,
            outputHeight: presetH,
            fitMode: fitMode,
            encoder: (settings.streamEncoder as string) || "libx264",
            sources: streamSources,
          });
        } catch (err: any) {
          console.error(
            "[TargetOutputNode] Failed to start native stream:",
            err,
          );
          showToast("Failed to start native stream.");
          return;
        }
        setIsStreaming(true);
        setShowStreamInput(false);
        return;
      }

      const canvas = canvasRef.current;
      if (!canvas) return;

      // If no native capture is active (preview not open), start one silently
      if (!isPreviewActive && !editOverlayOpen && activeStreamSources.length > 0) {
        await startNativePreviewCapture(activeStreamSources.map(s => s.source_id)).catch(console.error);
        streamOwnsCaptureRef.current = true;
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
            const primaryId = activeStreamSources.find(s => s.is_primary)?.source_id;
            const nc = primaryId ? nativePreviewCanvasesRef.current.get(primaryId) : undefined;
            if (nc && nc.width > 0 && nc.height > 0) {
              resolve({ w: nc.width, h: nc.height });
            } else if (performance.now() >= deadline) {
              console.warn(
                "[TargetOutputNode] Native canvas dimensions not available — falling back to 1280x720",
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

      const streamFps = finalFps;
      const frameDurationMs = 1000 / streamFps;
      const bitrateKbps = finalBitrate;

      // ── Preferred: WebCodecs hardware H.264 → FFmpeg copy-mux ─────────────────
      console.log(
        `[TargetOutputNode] Configuring encoder at ${encWidth}x${encHeight}`,
      );
      const encoderHandle = await createH264CanvasEncoder({
        width: encWidth,
        height: encHeight,
        fps: streamFps,
        bitrateKbps,
        onChunk: (buffer) => {
          window.electron.pushStreamData(buffer);
          //console.log(" --- Chunk pushed --- ");
        },
        onError: (err) =>
          console.error("[TargetOutputNode] H.264 encoder:", err),
      });

      if (encoderHandle) {
        console.log(
          `[TargetOutputNode] WebCodecs H.264 (${encoderHandle.codec}) at ${canvas.width}x${canvas.height} ${streamFps}fps → FFmpeg copy-mux`,
        );
        try {
          const initRes = await window.electron.startStream(resolvedRtmpUrl, {
            mode: "h264",
            fps: streamFps,
            bitrateKbps,
            streamDelayMs: finalDelay,
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
        streamFpsRef.current = finalFps;
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
      streamFpsRef.current = finalFps;
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
        const initRes = await window.electron.startStream(resolvedRtmpUrl, {
          mode: "mjpeg",
          encoder: finalEncoder,
          bitrateKbps,
          fps: streamFps,
          streamDelayMs: finalDelay,
          ...(presetW && presetH ? { width: presetW, height: presetH } : {}),
        });
        if (!initRes.success) {
          console.error(
            "[TargetOutputNode] Failed to initialize FFmpeg stream.",
          );
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
    } finally {
      setIsStarting(false);
    }
  }, [
    targetId,
    configType,
    customConfig,
    captureSourceId,
    activePreset,
    startNativePreviewCapture,
    renderCardCompositor,
    settings.streamEncoder,
    settings.streamFps,
    settings.streamDelayMs,
    settings.streamBitrateKbps,
    settings.rtmpTargets,
    isPreviewActive,
    editOverlayOpen,
  ]);

  const stopStreaming = useCallback(async () => {
    setIsStopping(true);
    try {
      // ── Native WGC path ───────────────────────────────────────────────────────
      if (
        captureSourceId?.startsWith("monitor:") ||
        captureSourceId?.startsWith("window:")
      ) {
        await window.electron.stopNativeStream();
        setIsStreaming(false);
        return;
      }

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
      if (
        streamOwnsCaptureRef.current &&
        !isPreviewActive &&
        !editOverlayOpen
      ) {
        stopNativePreviewCapture().catch(console.error);
        streamOwnsCaptureRef.current = false;
      }
    } finally {
      setIsStopping(false);
    }
  }, [
    captureSourceId,
    isPreviewActive,
    editOverlayOpen,
    stopNativePreviewCapture,
  ]);

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
    if (!isPreviewActive) {
      if (isRecording) stopRecording();
    }
  }, [isPreviewActive, isRecording, stopRecording]);

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
                    disabled={isStreaming || isRecording}
                    title={
                      isStreaming || isRecording
                        ? "Cannot change fit mode while streaming or recording"
                        : mode === "contain"
                          ? "Letterbox — show everything, black bars"
                          : mode === "cover"
                            ? "Crop to fill — no bars, edges cropped"
                            : "Stretch to fill — distorts aspect ratio"
                    }
                    className={cn(
                      "px-2 py-0.5 rounded text-[9px] font-semibold uppercase tracking-wider transition-colors",
                      isStreaming || isRecording
                        ? "cursor-not-allowed opacity-50"
                        : "cursor-pointer",
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
            className={cn(
              "relative rounded-lg border border-zinc-800 overflow-hidden bg-black flex flex-col items-center justify-center shadow-inner group transition-all duration-300",
              !isPreviewActive && captureSourceId ? "hidden" : ""
            )}
            style={{
              aspectRatio:
                !isPreviewActive && captureSourceId
                  ? undefined
                  : activePreset.aspect === "auto"
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
                  className={cn(
                    "w-full h-full",
                    fitMode === "cover" ? "object-cover" : fitMode === "stretch" ? "object-fill" : "object-contain"
                  )}
                  style={{
                    // Only show canvas visually when preview is explicitly enabled.
                    // Streaming uses the canvas via captureStream() even when hidden.
                    display: isPreviewActive ? "block" : "none",
                  }}
                />
              </>
            )}
            {!isPreviewActive && !isStreaming && !captureSourceId && (
              <div className="flex flex-col items-center gap-2 text-zinc-500 text-center px-4 py-8">
                <MonitorIcon className="w-8 h-8 text-zinc-700 stroke-[1.5]" />
                <span className="text-[10px]">
                  Connect Capture Source Node
                </span>
              </div>
            )}
          </div>

          {/* Record / Stream controls — visible whenever a capture source is connected */}
          {captureSourceId && (
            <div className="flex items-center gap-2 justify-between mt-1">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                disabled={!isPreviewActive}
                title={
                  !isPreviewActive
                    ? "Recording requires active stream preview"
                    : undefined
                }
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider border transition-all",
                  isRecording
                    ? "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 animate-pulse cursor-pointer"
                    : !isPreviewActive
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
                  isStreaming && !isStopping
                    ? stopStreaming
                    : !isStreaming && !isStarting
                      ? () => setShowStreamInput(!showStreamInput)
                      : undefined
                }
                disabled={isStopping || isStarting}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider border transition-all",
                  isStopping || isStarting
                    ? "bg-zinc-800 text-zinc-500 border-zinc-700 cursor-not-allowed"
                    : isStreaming
                      ? "bg-purple-500/10 text-purple-400 border-purple-500/20 hover:bg-purple-500/20 animate-pulse cursor-pointer"
                      : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-white cursor-pointer",
                )}
              >
                {isStopping ? (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full border border-zinc-500 border-t-transparent animate-spin inline-block" />{" "}
                    Ending...
                  </>
                ) : isStarting ? (
                  <>
                    <span className="w-2.5 h-2.5 rounded-full border border-zinc-500 border-t-transparent animate-spin inline-block" />{" "}
                    Starting...
                  </>
                ) : isStreaming ? (
                  <>
                    <SquareIcon className="w-2.5 h-2.5 fill-current" /> End
                    Stream
                  </>
                ) : (
                  <>
                    <RadioIcon className="w-2.5 h-2.5" /> Stream
                  </>
                )}
              </button>
            </div>
          )}

          {showStreamInput && !isStreaming && (
            <div className="flex flex-col gap-2 p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg mt-1 text-[11px]">
              {/* Target Selection */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                  Target
                </span>
                {(!settings.rtmpTargets || settings.rtmpTargets.length === 0) ? (
                  <span className="text-xs text-amber-500 italic">No stream services configured in settings.</span>
                ) : (
                  <select
                    value={targetId}
                    onChange={(e) => updateNodeDataField("streamTargetId", e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none cursor-pointer"
                  >
                    {settings.rtmpTargets.map((t) => (
                      <option key={t.id} value={t.id}>{t.label} ({t.preset})</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Stream Configuration Type */}
              <div className="flex flex-col gap-1 mt-1">
                <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                  Configuration
                </span>
                <select
                  value={configType}
                  onChange={(e) => updateNodeDataField("streamConfigType", e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none cursor-pointer"
                >
                  <option value="global">Global Settings</option>
                  <option value="custom">Custom Override</option>
                </select>
              </div>

              {/* Custom Overrides */}
              {configType === "custom" && (
                <>
                  {/* Bitrate */}
                  <div className="flex flex-col gap-1 mt-1">
                    <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                      Stream Bitrate (Kbps)
                    </span>
                    <input
                      type="number"
                      value={customConfig.streamBitrateKbps}
                      onChange={(e) => updateNodeDataField("streamCustomConfig", { ...customConfig, streamBitrateKbps: Number(e.target.value) || 6000 })}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none font-mono"
                    />
                  </div>
                  
                  {/* FPS + Encoder + Delay */}
                  <div className="flex gap-2 mt-1">
                    <div className="flex flex-col gap-1 w-16 shrink-0">
                      <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                        FPS
                      </span>
                      <select
                        value={customConfig.streamFps}
                        onChange={(e) => updateNodeDataField("streamCustomConfig", { ...customConfig, streamFps: Number(e.target.value) as 30 | 60 })}
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
                        value={customConfig.streamEncoder}
                        onChange={(e) => updateNodeDataField("streamCustomConfig", { ...customConfig, streamEncoder: e.target.value })}
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
                        value={customConfig.streamDelayMs}
                        onChange={(e) => updateNodeDataField("streamCustomConfig", { ...customConfig, streamDelayMs: Number(e.target.value) })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none cursor-pointer"
                      >
                        <option value={0}>None</option>
                        <option value={5000}>5s</option>
                        <option value={10000}>10s</option>
                        <option value={15000}>15s</option>
                      </select>
                    </div>
                  </div>
                </>
              )}

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
                  disabled={isStarting}
                  className={cn(
                    "text-[10px] px-2 py-0.5 rounded font-medium flex items-center gap-1.5 transition-all",
                    isStarting
                      ? "bg-zinc-700 text-zinc-400 cursor-not-allowed"
                      : "bg-indigo-600 hover:bg-indigo-500 text-white cursor-pointer",
                  )}
                >
                  {isStarting ? (
                    <>
                      <span className="w-2 h-2 rounded-full border border-zinc-400 border-t-transparent animate-spin inline-block" />
                      Starting...
                    </>
                  ) : (
                    "Stream"
                  )}
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

        {/* Live stream stats */}
        {isStreaming && streamStats && (
          <div className="nodrag nopan nowheel flex flex-col gap-1">
            {/* Compact row — always visible */}
            <div className="flex items-center gap-2 px-2 py-1.5 bg-zinc-950 border border-purple-500/20 rounded-lg text-[9px] font-mono">
              <span className="flex items-center gap-1 text-purple-400 font-sans font-semibold uppercase tracking-wider text-[8px] shrink-0">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                Live
              </span>
              <span className="text-zinc-700">│</span>
              <span
                className={cn(
                  "tabular-nums w-[4ch] text-right font-semibold",
                  (streamStats.fps ?? 0) >= 25
                    ? "text-emerald-400"
                    : (streamStats.fps ?? 0) >= 15
                      ? "text-amber-400"
                      : "text-red-400",
                )}
              >
                {streamStats.fps?.toFixed(1) ?? "—"}
              </span>
              <span className="text-zinc-600">fps</span>
              <span className="text-zinc-700">│</span>
              <span className="text-zinc-400 tabular-nums">
                {streamStats.time ?? "00:00:00"}
              </span>
              {streamStats.dropped != null && streamStats.dropped > 0 && (
                <>
                  <span className="text-zinc-700">│</span>
                  <span className="text-red-400 tabular-nums">
                    ▲{streamStats.dropped}
                  </span>
                </>
              )}
              <button
                onClick={() => setStatsExpanded((v) => !v)}
                className="ml-auto text-zinc-600 hover:text-zinc-300 cursor-pointer transition-colors"
                title={statsExpanded ? "Hide stats" : "Show stats"}
              >
                <ChevronDownIcon
                  className={cn(
                    "w-3 h-3 transition-transform duration-150",
                    statsExpanded && "rotate-180",
                  )}
                />
              </button>
            </div>

            {/* Expanded detail grid */}
            {statsExpanded && (
              <div className="grid grid-cols-[3.5rem_1fr] gap-x-3 gap-y-0.5 px-2.5 py-2 bg-zinc-950 border border-zinc-800 rounded-lg text-[9px] font-mono">
                <span className="text-zinc-600 uppercase tracking-wider text-[8px] self-center">
                  FPS
                </span>
                <span
                  className={cn(
                    "tabular-nums font-semibold",
                    (streamStats.fps ?? 0) >= 25
                      ? "text-emerald-400"
                      : (streamStats.fps ?? 0) >= 15
                        ? "text-amber-400"
                        : "text-red-400",
                  )}
                >
                  {streamStats.fps?.toFixed(1) ?? "—"}
                </span>

                <span className="text-zinc-600 uppercase tracking-wider text-[8px] self-center">
                  Frames
                </span>
                <span className="text-zinc-300 tabular-nums">
                  {streamStats.frame?.toLocaleString() ?? "—"}
                </span>

                <span className="text-zinc-600 uppercase tracking-wider text-[8px] self-center">
                  Uptime
                </span>
                <span className="text-zinc-300 tabular-nums">
                  {streamStats.time ?? "—"}
                </span>

                <span className="text-zinc-600 uppercase tracking-wider text-[8px] self-center">
                  Bitrate
                </span>
                <span className="text-zinc-300 tabular-nums">
                  {streamStats.bitrate ?? "—"}
                </span>

                <span className="text-zinc-600 uppercase tracking-wider text-[8px] self-center">
                  Dropped
                </span>
                <span
                  className={cn(
                    "tabular-nums",
                    streamStats.dropped != null && streamStats.dropped > 0
                      ? "text-red-400"
                      : "text-zinc-500",
                  )}
                >
                  {streamStats.dropped ?? 0}
                </span>

                {streamStats.speed && (
                  <>
                    <span className="text-zinc-600 uppercase tracking-wider text-[8px] self-center">
                      Speed
                    </span>
                    <span
                      className={cn(
                        "tabular-nums",
                        parseFloat(streamStats.speed) >= 0.9
                          ? "text-emerald-400"
                          : parseFloat(streamStats.speed) >= 0.5
                            ? "text-amber-400"
                            : "text-red-400",
                      )}
                    >
                      {streamStats.speed}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>
        )}
      </BaseNodeCard>

      {/* Target input handle */}
      <Handle
        id={`handle_${node.id}_overlay_target`}
        type="target"
        position={Position.Left}
        isConnectable={node.isConnectable}
        isValidConnection={isValidOverlayConnection}
        style={{ top: "34px" }}
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
