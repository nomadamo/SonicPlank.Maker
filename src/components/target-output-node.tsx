import { BaseNodeCard } from "./base-node";
import { cn } from "@/lib/utils";
import { Handle, NodeProps, Position, useEdges, useNodes } from "@xyflow/react";
import {
  Monitor as MonitorIcon,
  Play as PlayIcon,
  Square as SquareIcon,
  Maximize2 as MaximizeIcon,
  Disc as DiscIcon,
  Radio as RadioIcon,
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

export function TargetOutputNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const updateNodeData = useSetAtom(updateNodeDataAtom);
  const { settings } = useSettings();
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

  // Streaming states
  const [rtmpUrl, setRtmpUrl] = useState(() => {
    if (settings.streamUrl) {
      const baseUrl = settings.streamUrl.trim();
      const token = settings.streamToken?.trim() || "";
      if (token) {
        return baseUrl.endsWith("/") ? `${baseUrl}${token}` : `${baseUrl}/${token}`;
      }
      return baseUrl;
    }
    return (
      localStorage.getItem("rtmpUrl") ||
      "rtmp://a.rtmp.youtube.com/live2/YOUR_KEY"
    );
  });
  const [showStreamInput, setShowStreamInput] = useState(false);

  // Sync default stream settings to state when settings change
  useEffect(() => {
    if (settings.streamUrl) {
      const baseUrl = settings.streamUrl.trim();
      const token = settings.streamToken?.trim() || "";
      const fullUrl = token
        ? baseUrl.endsWith("/")
          ? `${baseUrl}${token}`
          : `${baseUrl}/${token}`
        : baseUrl;
      setRtmpUrl(fullUrl);
    } else {
      setRtmpUrl(
        localStorage.getItem("rtmpUrl") ||
          "rtmp://a.rtmp.youtube.com/live2/YOUR_KEY",
      );
    }
  }, [settings.streamUrl, settings.streamToken]);
  const streamRecorderRef = useRef<MediaRecorder | null>(null);

  // Audio Analyser states
  const cardAudioContextRef = useRef<AudioContext | null>(null);
  const cardAnalyserRef = useRef<AnalyserNode | null>(null);

  const cardRequestRef = useRef<number | null>(null);
  const cardImageCacheRef = useRef<Record<string, HTMLImageElement>>({});

  // Fetch the active capture stream hook
  const { stream, startCapture, stopCapture } = useScreenCapture();

  // Retrieve React Flow layout context (reactively updating when connections change)
  const edges = useEdges();
  const nodes = useNodes();

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
        width: 3840,
        height: 2160,
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
            ].includes(n.type || "")
          ),
      )
      .sort((a, b) => a.position.y - b.position.y);

    const list: OverlayElement[] = [];
    overlayNodes.forEach((n) => {
      const type = n.type?.replace("OverlayNode", "") as OverlayElement["type"];
      const data = n.data as any;
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
      });
    });

    return list;
  }, [edges, nodes, connectedOverlayGroupNode]);

  // Synchronise overlays to main process whenever they change
  useEffect(() => {
    window.electron.setOverlays(overlays);
  }, [overlays]);

  // Watch for source/preset changes and automatically restart capture stream if preview is active
  useEffect(() => {
    if (isPreviewActive && captureSourceId) {
      console.log(
        "[TargetOutputNode] Re-starting stream due to input properties modifications.",
      );
      startCapture(captureSourceId, captureAudio, {
        maxWidth: activePreset.width,
        maxHeight: activePreset.height,
      });
    }
  }, [
    captureSourceId,
    captureAudio,
    activePreset.width,
    activePreset.height,
    isPreviewActive,
    startCapture,
  ]);

  // Handle stream assignment to HTMLVideoElement
  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
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

    const targetWidth = activePreset.width || video.videoWidth || 1280;
    const targetHeight = activePreset.height || video.videoHeight || 720;
    if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
      canvas.width = targetWidth;
      canvas.height = targetHeight;
    }

    // 1. Draw base video frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 2. Draw overlays sequentially
    overlays.forEach((overlay) => {
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
        ctx.font = `${overlay.fontStyle || "normal"} ${overlay.fontWeight || "normal"} ${sizePx}px ${overlay.fontFamily || "Inter, sans-serif"}`;
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
        const edgeToVisualizer = edges.find((e) => e.target === overlay.id);
        let analyser: AnalyserNode | null = null;
        if (edgeToVisualizer) {
          analyser = getFlowAudioAnalyser(edgeToVisualizer.source);
        }
        if (!analyser) {
          analyser = cardAnalyserRef.current;
        }

        if (analyser) {
          ctx.fillStyle = overlay.backgroundColor || "rgba(0, 0, 0, 0.3)";
          ctx.fillRect(xVal, yVal, wVal, hVal);

          const vType = overlay.visualizerType || "bars";
          const bufferLength = analyser.frequencyBinCount;
          const dataArray = new Uint8Array(bufferLength);

          // Populate data array based on type
          if (vType === "wave") {
            analyser.getByteTimeDomainData(dataArray);
          } else {
            analyser.getByteFrequencyData(dataArray);
          }

          // Broadcast frequency/time-domain data array to other windows (popped out preview)
          window.parent
            ? (window.parent as any).electron?.sendAudioData?.(
                overlay.id,
                Array.from(dataArray),
              )
            : window.electron?.sendAudioData?.(
                overlay.id,
                Array.from(dataArray),
              );

          // Draw visualizer style
          if (vType === "wave") {
            ctx.strokeStyle = "#06b6d4";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            const sliceWidth = wVal / bufferLength;
            let lx = xVal;
            for (let i = 0; i < bufferLength; i++) {
              const v = dataArray[i] / 128.0;
              const ly = yVal + (v * hVal) / 2;
              if (i === 0) {
                ctx.moveTo(lx, ly);
              } else {
                ctx.lineTo(lx, ly);
              }
              lx += sliceWidth;
            }
            ctx.stroke();
          } else if (vType === "circle") {
            const centerX = xVal + wVal / 2;
            const centerY = yVal + hVal / 2;
            const baseRadius = Math.min(wVal, hVal) * 0.15;
            const maxRadius = Math.min(wVal, hVal) * 0.45;

            const step = Math.max(1, Math.floor(bufferLength / 80));
            for (let i = 0; i < bufferLength; i += step) {
              const angle = (i / bufferLength) * Math.PI * 2;
              const amplitude = dataArray[i] / 255;
              const currentRadius =
                baseRadius + amplitude * (maxRadius - baseRadius);

              const startX = centerX + Math.cos(angle) * baseRadius;
              const startY = centerY + Math.sin(angle) * baseRadius;
              const endX = centerX + Math.cos(angle) * currentRadius;
              const endY = centerY + Math.sin(angle) * currentRadius;

              const hue = 180 + (i / bufferLength) * 80;
              ctx.strokeStyle = `hsl(${hue}, 85%, 55%)`;
              ctx.lineWidth = 2.5;
              ctx.beginPath();
              ctx.moveTo(startX, startY);
              ctx.lineTo(endX, endY);
              ctx.stroke();
            }
          } else if (vType === "blocks") {
            const numBlocksY = 8;
            const step = Math.max(1, Math.floor(bufferLength / 40));
            const displayCount = Math.floor(bufferLength / step);
            const barWidth = wVal / displayCount;
            let posX = xVal;

            for (let i = 0; i < bufferLength; i += step) {
              const amplitude = dataArray[i] / 255;
              const barHeight = amplitude * hVal;
              const blocksToDraw = Math.round((barHeight / hVal) * numBlocksY);
              const blockHeight = hVal / numBlocksY - 1.5;

              for (let j = 0; j < blocksToDraw; j++) {
                const blockY = yVal + hVal - (j + 1) * (blockHeight + 1.5);
                ctx.fillStyle =
                  j < numBlocksY * 0.4
                    ? "#6366f1"
                    : j < numBlocksY * 0.75
                      ? "#3b82f6"
                      : "#06b6d4";
                ctx.fillRect(posX, blockY, barWidth - 1.5, blockHeight);
              }
              posX += barWidth;
            }
          } else if (vType === "dots") {
            const dotCount = 24;
            const dotSpacing = wVal / dotCount;
            for (let i = 0; i < dotCount; i++) {
              const idx = Math.floor((i / dotCount) * bufferLength);
              const amplitude = dataArray[idx] / 255;
              const dotX = xVal + i * dotSpacing + dotSpacing / 2;
              const dotY = yVal + hVal - amplitude * hVal;
              const dotRadius = Math.max(2.5, amplitude * 7);

              ctx.fillStyle = "#06b6d4";
              ctx.beginPath();
              ctx.arc(dotX, dotY, dotRadius, 0, Math.PI * 2);
              ctx.fill();
            }
          } else {
            const barWidth = (wVal / bufferLength) * 1.5;
            let barHeight;
            let posX = xVal;

            for (let i = 0; i < bufferLength; i++) {
              barHeight = (dataArray[i] / 255) * hVal;

              const gradient = ctx.createLinearGradient(
                posX,
                yVal + hVal,
                posX,
                yVal + hVal - barHeight,
              );
              gradient.addColorStop(0, "#6366f1");
              gradient.addColorStop(1, "#06b6d4");

              ctx.fillStyle = gradient;
              ctx.fillRect(
                posX,
                yVal + hVal - barHeight,
                barWidth - 1,
                barHeight,
              );

              posX += barWidth + 1;
              if (posX >= xVal + wVal) break;
            }
          }
        }
      }

      ctx.restore();
    });

    cardRequestRef.current = requestAnimationFrame(renderCardCompositor);
  }, [overlays, activePreset]);

  // Handle compositor loop activation
  useEffect(() => {
    if (isPreviewActive && stream) {
      cardRequestRef.current = requestAnimationFrame(renderCardCompositor);
    }
    return () => {
      if (cardRequestRef.current) {
        cancelAnimationFrame(cardRequestRef.current);
      }
    };
  }, [isPreviewActive, stream, renderCardCompositor]);

  const handlePopOut = useCallback(() => {
    if (!captureSourceId) return;
    const url = `index.html#/preview?sourceId=${captureSourceId}&audio=${captureAudio}&maxWidth=${activePreset.width}&maxHeight=${activePreset.height}&aspect=${activePreset.aspect}`;
    window.open(url, "_blank", "width=1280,height=720,frame=true");
  }, [captureSourceId, captureAudio, activePreset]);

  const handleTogglePreview = useCallback(async () => {
    if (isPreviewActive) {
      stopCapture();
      setIsPreviewActive(false);
    } else {
      if (!captureSourceId) return;
      setIsPreviewActive(true);
      const activeStream = await startCapture(captureSourceId, captureAudio, {
        maxWidth: activePreset.width,
        maxHeight: activePreset.height,
      });
      if (!activeStream) {
        setIsPreviewActive(false);
      }
    }
  }, [
    isPreviewActive,
    captureSourceId,
    captureAudio,
    startCapture,
    stopCapture,
    activePreset,
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

    let options = { mimeType: "video/webm;codecs=h264" };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: "video/webm;codecs=vp9" };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: "video/webm" };
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

  // RTMP Streaming
  const startStreaming = useCallback(async () => {
    if (!rtmpUrl) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    localStorage.setItem("rtmpUrl", rtmpUrl);

    const streamToStream = (canvas as any).captureStream
      ? (canvas as any).captureStream(60)
      : null;
    if (!streamToStream) {
      console.error("Canvas captureStream is not supported.");
      return;
    }

    if (stream) {
      stream.getAudioTracks().forEach((track) => {
        streamToStream.addTrack(track);
      });
    }

    try {
      const initRes = await window.electron.startStream(rtmpUrl);
      if (!initRes.success) {
        console.error("Failed to initialize main process stream.");
        return;
      }
    } catch (err) {
      console.error("Failed to start stream:", err);
      return;
    }

    let options = { mimeType: "video/webm;codecs=h264,opus" };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: "video/webm;codecs=vp8,opus" };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: "video/webm" };
    }

    console.log(
      "[TargetOutputNode] Starting Streaming MediaRecorder with mimeType:",
      options.mimeType,
    );

    const recorder = new MediaRecorder(streamToStream, options);
    recorder.ondataavailable = async (event) => {
      if (event.data && event.data.size > 0) {
        const arrayBuffer = await event.data.arrayBuffer();
        window.electron.pushStreamData(arrayBuffer);
      }
    };

    recorder.start(100);
    streamRecorderRef.current = recorder;
    setIsStreaming(true);
    setShowStreamInput(false);
  }, [stream, rtmpUrl]);

  const stopStreaming = useCallback(async () => {
    if (streamRecorderRef.current) {
      streamRecorderRef.current.stop();
      streamRecorderRef.current = null;
    }
    await window.electron.stopStream();
    setIsStreaming(false);
  }, []);

  // Clean up recording and streaming if capture is toggled off
  useEffect(() => {
    if (!isPreviewActive || !stream) {
      if (isRecording) stopRecording();
      if (isStreaming) stopStreaming();
    }
  }, [
    isPreviewActive,
    stream,
    isRecording,
    isStreaming,
    stopRecording,
    stopStreaming,
  ]);

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
        {/* Handle labels */}
        <div className="absolute left-3.5 top-[33.3%] -translate-y-1/2 text-[9px] font-bold text-zinc-500 uppercase tracking-wider pointer-events-none select-none">
          Source
        </div>
        <div className="absolute left-3.5 top-[66.6%] -translate-y-1/2 text-[9px] font-bold text-zinc-500 uppercase tracking-wider pointer-events-none select-none">
          Overlays
        </div>

        {/* Live Video Preview Area */}
        <div className="flex flex-col gap-1.5 nodrag nopan nowheel">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
              Live Output Preview
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
                      <SquareIcon className="w-2.5 h-2.5 fill-current" /> Stop
                    </>
                  ) : (
                    <>
                      <PlayIcon className="w-2.5 h-2.5 fill-current" /> Preview
                    </>
                  )}
                </button>

                {isPreviewActive && (
                  <button
                    onClick={handlePopOut}
                    className="p-1 rounded bg-zinc-800 border border-zinc-700 hover:bg-zinc-700 text-zinc-300 hover:text-white transition-colors cursor-pointer"
                    title="Pop out preview"
                  >
                    <MaximizeIcon className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
          </div>

          <div
            className="relative rounded-lg border border-zinc-800 overflow-hidden bg-black flex flex-col items-center justify-center shadow-inner group transition-all duration-300"
            style={{
              aspectRatio:
                activePreset.aspect === "auto"
                  ? dynamicAspectRatio
                  : activePreset.aspect,
            }}
          >
            {isPreviewActive && stream ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  onLoadedMetadata={handleVideoLoadedMetadata}
                  className="hidden"
                />
                <canvas
                  ref={canvasRef}
                  className="w-full h-full object-contain"
                />
              </>
            ) : (
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

          {/* Record / Stream controls */}
          {isPreviewActive && stream && (
            <div className="flex items-center gap-2 justify-between mt-1">
              <button
                onClick={isRecording ? stopRecording : startRecording}
                className={cn(
                  "flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-[10px] font-semibold uppercase tracking-wider cursor-pointer border transition-all",
                  isRecording
                    ? "bg-red-500/10 text-red-400 border-red-500/20 hover:bg-red-500/20 animate-pulse"
                    : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-white",
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
                    <SquareIcon className="w-2.5 h-2.5 fill-current" /> Stop
                    Live
                  </>
                ) : (
                  <>
                    <RadioIcon className="w-2.5 h-2.5" /> Go Live
                  </>
                )}
              </button>
            </div>
          )}

          {showStreamInput && isPreviewActive && stream && (
            <div className="flex flex-col gap-2 p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg mt-1 text-[11px]">
              <div className="flex flex-col gap-0.5">
                <span className="font-semibold text-zinc-200">
                  RTMP Target URL
                </span>
                <span className="text-[9px] text-zinc-500">
                  Provide RTMP endpoint + key
                </span>
              </div>
              <input
                type="text"
                value={rtmpUrl}
                onChange={(e) => setRtmpUrl(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
                placeholder="rtmp://..."
              />
              <div className="flex gap-2 justify-end">
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
      </BaseNodeCard>

      {/* Target input handles */}
      <Handle
        id={`handle_${node.id}_source_target`}
        type="target"
        position={Position.Left}
        isConnectable={node.isConnectable}
        isValidConnection={isValidSourceConnection}
        style={{ top: "33.3%" }}
        className="hover:!border-red-400 hover:!shadow-[0_0_10px_rgba(248,113,113,0.5)] hover:!scale-125"
      />
      <Handle
        id={`handle_${node.id}_overlay_target`}
        type="target"
        position={Position.Left}
        isConnectable={node.isConnectable}
        isValidConnection={isValidOverlayConnection}
        style={{ top: "66.6%" }}
        className="hover:!border-red-400 hover:!shadow-[0_0_10px_rgba(248,113,113,0.5)] hover:!scale-125"
      />
    </>
  );
}
export default TargetOutputNode;
