import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { useScreenCapture } from "@/hooks/useScreenCapture";
import { Loader2, Radio, Disc, Square, Monitor, Lock, Unlock } from "lucide-react";
import { OverlayElement } from "@/types/flow-node";
import { useSettings } from "@/store/settingsStore";

export const Route = createFileRoute("/preview")({
  validateSearch: (search: Record<string, unknown>) => {
    return {
      sourceId: (search.sourceId as string) || "",
      audio: (search.audio as string) || "false",
      maxWidth: search.maxWidth ? Number(search.maxWidth) : undefined,
      maxHeight: search.maxHeight ? Number(search.maxHeight) : undefined,
      aspect: (search.aspect as string) || "auto",
    };
  },
  component: PreviewComponent,
});

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
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
  const twitchMatch = trimmed.match(/https?:\/\/(?:www\.)?twitch\.tv\/[^/]+\/(live_[a-zA-Z0-9_]+)/i);
  if (twitchMatch) {
    return `rtmp://live.twitch.tv/app/${twitchMatch[1]}`;
  }
  return trimmed;
}

function PreviewComponent() {
  const { sourceId, audio, maxWidth, maxHeight, aspect } = Route.useSearch();
  const captureAudio = audio === "true";
  const { settings } = useSettings();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const requestRef = useRef<number | null>(null);
  const imageCacheRef = useRef<Record<string, HTMLImageElement>>({});

  const [overlays, setOverlays] = useState<OverlayElement[]>([]);
  const [dynamicAspectRatio, setDynamicAspectRatio] = useState<string>("16/9");

  // Draggable overlays state & refs
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isLocked, setIsLocked] = useState(true);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const dragStartRef = useRef<{
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  }>({ offsetX: 0, offsetY: 0, width: 0, height: 0 });

  // Resizable overlays state & refs
  const [activeResizeId, setActiveResizeId] = useState<string | null>(null);
  const [activeHandle, setActiveHandle] = useState<string | null>(null);
  const resizeStartRef = useRef<{
    x: number;
    y: number;
    width: number;
    height: number;
    clickX: number;
    clickY: number;
    aspectRatio: number;
  }>({ x: 0, y: 0, width: 0, height: 0, clickX: 0, clickY: 0, aspectRatio: 1 });

  const handleMouseDown = (e: React.MouseEvent, overlay: OverlayElement) => {
    e.preventDefault();
    e.stopPropagation();

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * 100;
    const clickY = ((e.clientY - rect.top) / rect.height) * 100;

    dragStartRef.current = {
      offsetX: clickX - overlay.x,
      offsetY: clickY - overlay.y,
      width: overlay.width,
      height: overlay.height,
    };

    setActiveDragId(overlay.id);
  };

  const handleResizeMouseDown = (
    e: React.MouseEvent,
    overlay: OverlayElement,
    handle: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const clickX = ((e.clientX - rect.left) / rect.width) * 100;
    const clickY = ((e.clientY - rect.top) / rect.height) * 100;

    resizeStartRef.current = {
      x: overlay.x,
      y: overlay.y,
      width: overlay.width,
      height: overlay.height,
      clickX,
      clickY,
      aspectRatio: overlay.width / (overlay.height || 1),
    };

    setActiveResizeId(overlay.id);
    setActiveHandle(handle);
  };

  useEffect(() => {
    if (!activeDragId) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const currentX = ((e.clientX - rect.left) / rect.width) * 100;
      const currentY = ((e.clientY - rect.top) / rect.height) * 100;

      const start = dragStartRef.current;
      let newX = currentX - start.offsetX;
      let newY = currentY - start.offsetY;

      // Clamp coordinates to keep overlay inside canvas container boundaries
      newX = Math.max(0, Math.min(100 - start.width, newX));
      newY = Math.max(0, Math.min(100 - start.height, newY));

      // Round coordinates to nearest 0.1
      newX = Math.round(newX * 10) / 10;
      newY = Math.round(newY * 10) / 10;

      setOverlays((prev) =>
        prev.map((o) => (o.id === activeDragId ? { ...o, x: newX, y: newY } : o)),
      );
    };

    const handleMouseUp = () => {
      setActiveDragId(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [activeDragId]);

  useEffect(() => {
    if (!activeResizeId || !activeHandle) return;

    const handleMouseMove = (e: MouseEvent) => {
      const container = containerRef.current;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const currentX = ((e.clientX - rect.left) / rect.width) * 100;
      const currentY = ((e.clientY - rect.top) / rect.height) * 100;

      const start = resizeStartRef.current;
      const dx = currentX - start.clickX;
      const dy = currentY - start.clickY;

      let newX = start.x;
      let newY = start.y;
      let newWidth = start.width;
      let newHeight = start.height;
      const R = start.aspectRatio;

      const maintainAspect = e.ctrlKey;

      switch (activeHandle) {
        case "r":
          newWidth = start.width + dx;
          if (maintainAspect) {
            newHeight = newWidth / R;
          }
          break;
        case "l":
          newWidth = start.width - dx;
          if (maintainAspect) {
            newHeight = newWidth / R;
          }
          newX = start.x + (start.width - newWidth);
          break;
        case "b":
          newHeight = start.height + dy;
          if (maintainAspect) {
            newWidth = newHeight * R;
          }
          break;
        case "t":
          newHeight = start.height - dy;
          if (maintainAspect) {
            newWidth = newHeight * R;
          }
          newY = start.y + (start.height - newHeight);
          break;
        case "br":
          newWidth = start.width + dx;
          newHeight = start.height + dy;
          if (maintainAspect) {
            if (Math.abs(dx) > Math.abs(dy)) {
              newHeight = newWidth / R;
            } else {
              newWidth = newHeight * R;
            }
          }
          break;
        case "bl":
          newWidth = start.width - dx;
          newHeight = start.height + dy;
          if (maintainAspect) {
            if (Math.abs(dx) > Math.abs(dy)) {
              newHeight = newWidth / R;
            } else {
              newWidth = newHeight * R;
            }
          }
          newX = start.x + (start.width - newWidth);
          break;
        case "tr":
          newWidth = start.width + dx;
          newHeight = start.height - dy;
          if (maintainAspect) {
            if (Math.abs(dx) > Math.abs(dy)) {
              newHeight = newWidth / R;
            } else {
              newWidth = newHeight * R;
            }
          }
          newY = start.y + (start.height - newHeight);
          break;
        case "tl":
          newWidth = start.width - dx;
          newHeight = start.height - dy;
          if (maintainAspect) {
            if (Math.abs(dx) > Math.abs(dy)) {
              newHeight = newWidth / R;
            } else {
              newWidth = newHeight * R;
            }
          }
          newX = start.x + (start.width - newWidth);
          newY = start.y + (start.height - newHeight);
          break;
      }

      // Constrain minimum size
      const minSize = 2;
      if (newWidth < minSize) {
        if (activeHandle === "l" || activeHandle === "bl" || activeHandle === "tl") {
          newX = start.x + start.width - minSize;
        }
        newWidth = minSize;
        if (maintainAspect) newHeight = minSize / R;
      }
      if (newHeight < minSize) {
        if (activeHandle === "t" || activeHandle === "tr" || activeHandle === "tl") {
          newY = start.y + start.height - minSize;
        }
        newHeight = minSize;
        if (maintainAspect) newWidth = minSize * R;
      }

      // Constrain inside bounds [0, 100]
      if (newX < 0) {
        newWidth = newWidth + newX;
        newX = 0;
        if (maintainAspect) newHeight = newWidth / R;
      }
      if (newY < 0) {
        newHeight = newHeight + newY;
        newY = 0;
        if (maintainAspect) newWidth = newHeight * R;
      }
      if (newX + newWidth > 100) {
        newWidth = 100 - newX;
        if (maintainAspect) newHeight = newWidth / R;
      }
      if (newY + newHeight > 100) {
        newHeight = 100 - newY;
        if (maintainAspect) newWidth = newHeight * R;
      }

      // Round to nearest 0.1
      newX = Math.round(newX * 10) / 10;
      newY = Math.round(newY * 10) / 10;
      newWidth = Math.round(newWidth * 10) / 10;
      newHeight = Math.round(newHeight * 10) / 10;

      setOverlays((prev) =>
        prev.map((o) =>
          o.id === activeResizeId
            ? { ...o, x: newX, y: newY, width: newWidth, height: newHeight }
            : o,
        ),
      );
    };

    const handleMouseUp = () => {
      setActiveResizeId(null);
      setActiveHandle(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [activeResizeId, activeHandle]);

  const toggleLocked = () => {
    if (!isLocked) {
      // Locking the layout -> send a single setOverlays update via IPC
      window.electron.setOverlays(overlays);
    }
    setIsLocked((prev) => !prev);
  };

  // Recording states
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);

  // Streaming states
  const [isStreaming, setIsStreaming] = useState(false);
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
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioDataMapRef = useRef<Record<string, number[]>>({});

  const { stream, startCapture, stopCapture } = useScreenCapture();

  // Load physical display capture
  useEffect(() => {
    if (sourceId) {
      console.log(
        `[PreviewWindow] Starting capture for sourceId: ${sourceId}, audio: ${captureAudio}, bounds: ${maxWidth}x${maxHeight}`,
      );
      startCapture(sourceId, captureAudio, { maxWidth, maxHeight });
    }
    return () => {
      console.log("[PreviewWindow] Stopping capture tracks.");
      stopCapture();
    };
  }, [sourceId, captureAudio, startCapture, stopCapture, maxWidth, maxHeight]);

  // Handle stream injection to offscreen video tag
  useEffect(() => {
    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    videoRef.current = video;

    if (stream) {
      video.srcObject = stream;
      video.play().catch((err) => {
        console.error("[PreviewWindow] Video metadata play failed:", err);
      });

      video.onloadedmetadata = () => {
        if (video.videoWidth && video.videoHeight) {
          setDynamicAspectRatio(`${video.videoWidth}/${video.videoHeight}`);
        }
      };

      // Set up audio analyser if captureAudio is true
      if (stream.getAudioTracks().length > 0) {
        try {
          const AudioContextClass =
            window.AudioContext || (window as any).webkitAudioContext;
          const audioContext = new AudioContextClass();
          const source = audioContext.createMediaStreamSource(stream);
          const analyser = audioContext.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);
          audioContextRef.current = audioContext;
          analyserRef.current = analyser;
        } catch (err) {
          console.error("[PreviewWindow] Audio analyser setup failed:", err);
        }
      }
    }

    return () => {
      video.srcObject = null;
      videoRef.current = null;
      if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
        analyserRef.current = null;
      }
    };
  }, [stream]);

  // Subscribe to overlay configuration updates
  useEffect(() => {
    // Fetch initial overlays layout on startup
    window.electron
      .getOverlays()
      .then((initialOverlays) => {
        console.log(
          "[PreviewWindow] Loaded initial overlays:",
          initialOverlays,
        );
        if (initialOverlays) setOverlays(initialOverlays);
      })
      .catch((err) => {
        console.error("[PreviewWindow] Failed to load initial overlays:", err);
      });

    window.electron.onOverlaysUpdated((updatedOverlays) => {
      console.log("[PreviewWindow] Overlays updated:", updatedOverlays);
      setOverlays(updatedOverlays || []);
    });
    return () => {
      window.electron.removeOnOverlaysUpdated(() => {});
    };
  }, []);

  // Load and inject theme styles from ASAR/directory container
  useEffect(() => {
    window.electron
      .getAvailableThemes()
      .then((themes) => {
        const defaultTheme = themes.find((t) => t.id === "default") || themes[0];
        if (defaultTheme) {
          window.electron
            .loadThemeStyles(defaultTheme.id)
            .then((styles) => {
              let styleTag = document.getElementById("preview-theme-styles");
              if (!styleTag) {
                styleTag = document.createElement("style");
                styleTag.id = "preview-theme-styles";
                document.head.appendChild(styleTag);
              }
              styleTag.textContent = styles;
              console.log(`[PreviewWindow] Loaded theme styles: ${defaultTheme.name}`);
            })
            .catch((err) => console.error("[PreviewWindow] Failed to load theme CSS:", err));
        }
      })
      .catch((err) => console.error("[PreviewWindow] Failed to fetch available themes:", err));
  }, []);

  // Subscribe to real-time audio data from the main window compositor
  useEffect(() => {
    window.electron.onAudioDataUpdated((visualizerId, dataArray) => {
      audioDataMapRef.current[visualizerId] = dataArray;
    });
    return () => {
      window.electron.removeOnAudioDataUpdated();
    };
  }, []);

  // Keep track of audio node playback times in a ref to avoid triggering component re-renders
  const audioTimesRef = useRef<Record<string, { currentTime: number; duration: number }>>({});

  // Subscribe to real-time audio playback time updates
  useEffect(() => {
    const handleTimeUpdated = (nodeId: string, currentTime: number) => {
      // Find duration of this audio node from active overlays
      const overlay = overlays.find((o) => o.audioNodeId === nodeId && o.type === "nowPlaying");
      const duration = overlay?.duration !== undefined ? Number(overlay.duration) : 0;
      audioTimesRef.current[nodeId] = { currentTime, duration };
    };

    window.electron.onAudioTimeUpdated(handleTimeUpdated);
    return () => {
      window.electron.removeOnAudioTimeUpdated();
    };
  }, [overlays]);

  // Compositor render loop
  const renderCompositor = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas || !video || video.readyState < 2) {
      requestRef.current = requestAnimationFrame(renderCompositor);
      return;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) {
      requestRef.current = requestAnimationFrame(renderCompositor);
      return;
    }

    // Set canvas dimensions matching resolution requirements
    const targetWidth = maxWidth || video.videoWidth || 1280;
    const targetHeight = maxHeight || video.videoHeight || 720;
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
        let img = imageCacheRef.current[overlay.imagePath];
        if (!img) {
          img = new Image();
          img.src =
            overlay.imagePath.startsWith("http") ||
            overlay.imagePath.startsWith("file://")
              ? overlay.imagePath
              : `file:///${overlay.imagePath.replace(/\\/g, "/")}`;
          imageCacheRef.current[overlay.imagePath] = img;
        }
        if (img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, xVal, yVal, wVal, hVal);
        }
      } else if (overlay.type === "visualizer") {
        // Retrieve IPC frequency data array if broadcasted, otherwise fallback to local stream analyser
        const cachedData = audioDataMapRef.current[overlay.id];
        let dataArray: Uint8Array | number[] | null = null;
        let bufferLength = 0;

        if (cachedData) {
          dataArray = cachedData;
          bufferLength = cachedData.length;
        } else if (analyserRef.current) {
          bufferLength = analyserRef.current.frequencyBinCount;
          const u8Array = new Uint8Array(bufferLength);
          const vType = overlay.visualizerType || "bars";
          if (vType === "wave") {
            analyserRef.current.getByteTimeDomainData(u8Array);
          } else {
            analyserRef.current.getByteFrequencyData(u8Array);
          }
          dataArray = u8Array;
        }

        if (dataArray && bufferLength > 0) {
          ctx.fillStyle = overlay.backgroundColor || "rgba(0, 0, 0, 0.3)";
          ctx.fillRect(xVal, yVal, wVal, hVal);

          const vType = overlay.visualizerType || "bars";

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
      } else if (overlay.type === "nowPlaying") {
        // Draw Now Playing Overlay
        const tracking = overlay.audioNodeId ? audioTimesRef.current[overlay.audioNodeId] : null;
        const curTime = tracking ? tracking.currentTime : 0;
        const totalDur = tracking ? tracking.duration : 0;
        const pct = totalDur > 0 ? curTime / totalDur : 0;

        const pad = hVal * 0.12;
        const artSize = hVal - pad * 2;
        const artX = xVal + pad;
        const artY = yVal + pad;

        // Card Background
        drawRoundedRect(ctx, xVal, yVal, wVal, hVal, hVal * 0.15);
        ctx.fillStyle = "rgba(12, 12, 12, 0.85)";
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Cover Art
        ctx.save();
        drawRoundedRect(ctx, artX, artY, artSize, artSize, artSize * 0.12);
        ctx.clip();
        
        let img = overlay.albumArt ? imageCacheRef.current[overlay.albumArt] : null;
        if (overlay.albumArt && !img) {
          img = new Image();
          img.src = overlay.albumArt;
          imageCacheRef.current[overlay.albumArt] = img;
        }
        
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, artX, artY, artSize, artSize);
        } else {
          // Fallback placeholder gradient
          const grad = ctx.createLinearGradient(artX, artY, artX + artSize, artY + artSize);
          grad.addColorStop(0, "#4f46e5");
          grad.addColorStop(1, "#06b6d4");
          ctx.fillStyle = grad;
          ctx.fill();
          // Draw music symbol
          ctx.fillStyle = "#ffffff";
          ctx.font = `${artSize * 0.4}px sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText("🎵", artX + artSize / 2, artY + artSize / 2);
        }
        ctx.restore();

        // Text Information
        const textX = artX + artSize + pad;
        const titleY = yVal + pad + artSize * 0.12;
        const artistY = yVal + pad + artSize * 0.48;

        ctx.fillStyle = "#ffffff";
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.font = `bold ${artSize * 0.22}px Inter, sans-serif`;
        
        // Truncate title if too long
        const maxTextWidth = wVal - (pad * 3 + artSize) - pad;
        let displayTitle = overlay.title || "No Track Connected";
        if (ctx.measureText(displayTitle).width > maxTextWidth) {
          while (displayTitle.length > 0 && ctx.measureText(displayTitle + "...").width > maxTextWidth) {
            displayTitle = displayTitle.slice(0, -1);
          }
          displayTitle += "...";
        }
        ctx.fillText(displayTitle, textX, titleY);

        // Artist
        ctx.fillStyle = "#a1a1aa";
        ctx.font = `500 ${artSize * 0.16}px Inter, sans-serif`;
        let displayArtist = overlay.artist || "Connect Audio Source";
        if (ctx.measureText(displayArtist).width > maxTextWidth) {
          while (displayArtist.length > 0 && ctx.measureText(displayArtist + "...").width > maxTextWidth) {
            displayArtist = displayArtist.slice(0, -1);
          }
          displayArtist += "...";
        }
        ctx.fillText(displayArtist, textX, artistY);

        // Progress Line & Timer
        const progressY = yVal + hVal - pad * 1.6;
        const timerSpace = artSize * 0.75; // Approx width of MM:SS / MM:SS
        const barW = Math.max(10, wVal - (pad * 3 + artSize) - timerSpace - pad * 2);
        
        // Progress background
        ctx.fillStyle = "rgba(255, 255, 255, 0.1)";
        ctx.beginPath();
        drawRoundedRect(ctx, textX, progressY, barW, hVal * 0.04, hVal * 0.02);
        ctx.fill();

        // Progress active
        if (pct > 0) {
          ctx.fillStyle = "#6366f1"; // Indigo accent
          ctx.beginPath();
          drawRoundedRect(ctx, textX, progressY, barW * pct, hVal * 0.04, hVal * 0.02);
          ctx.fill();
        }

        // Timestamps
        ctx.fillStyle = "#a1a1aa";
        ctx.font = `500 ${artSize * 0.14}px monospace, sans-serif`;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        const timeStr = `${formatTime(curTime)} / ${formatTime(totalDur)}`;
        ctx.fillText(timeStr, xVal + wVal - pad, progressY + (hVal * 0.02));
      }

      ctx.restore();
    });

    requestRef.current = requestAnimationFrame(renderCompositor);
  }, [overlays, maxWidth, maxHeight]);

  // Trigger render loop on stream load
  useEffect(() => {
    requestRef.current = requestAnimationFrame(renderCompositor);
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [renderCompositor]);

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
      "[PreviewWindow] Starting MediaRecorder with mimeType:",
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
        await window.electron.saveRecording(fileName, arrayBuffer, settings.recordingPath);
        console.log("[PreviewWindow] Disk capture saved successfully.");
      } catch (err) {
        console.error("[PreviewWindow] Failed to save capture to disk:", err);
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
      const initRes = await window.electron.startStream(rtmpUrl, {
        encoder: settings.streamEncoder || "copy",
        bitrateKbps: settings.streamBitrateKbps || 6000,
      });
      if (!initRes.success) {
        console.error("Failed to initialize main process stream.");
        return;
      }
    } catch (err) {
      console.error("Failed to start stream:", err);
      return;
    }

    const videoBitrate = (settings.streamBitrateKbps || 6000) * 1000;
    let options = {
      mimeType: "video/webm;codecs=h264,opus",
      videoBitsPerSecond: videoBitrate,
    };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = {
        mimeType: "video/webm;codecs=vp8,opus",
        videoBitsPerSecond: videoBitrate,
      };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = {
        mimeType: "video/webm",
        videoBitsPerSecond: videoBitrate,
      };
    }

    console.log(
      "[PreviewWindow] Starting Streaming MediaRecorder with mimeType:",
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

  const aspectValue = aspect === "auto" ? dynamicAspectRatio : aspect;

  return (
    <div className="relative w-screen h-screen bg-black flex flex-col items-center justify-center overflow-hidden select-none group">
      {stream ? (
        <div
          ref={containerRef}
          className="relative max-w-full max-h-full flex items-center justify-center animate-fade-in"
          style={{ aspectRatio: aspectValue }}
        >
          <canvas
            ref={canvasRef}
            className="w-full h-full object-contain block"
          />

          {/* Draggable Layer when Unlocked */}
          {!isLocked && (
            <div className="absolute inset-0 z-50 pointer-events-none">
              {overlays.map((overlay) => (
                <div
                  key={overlay.id}
                  onMouseDown={(e) => handleMouseDown(e, overlay)}
                  className="absolute pointer-events-auto border-2 border-dashed border-indigo-500 bg-indigo-500/10 cursor-move rounded flex flex-col justify-between p-1.5 select-none hover:bg-indigo-500/20 hover:border-indigo-400 transition-colors"
                  style={{
                    left: `${overlay.x}%`,
                    top: `${overlay.y}%`,
                    width: `${overlay.width}%`,
                    height: `${overlay.height}%`,
                  }}
                >
                  <div className="bg-indigo-600/90 backdrop-blur-sm text-[9px] font-bold text-white px-1.5 py-0.5 rounded shadow self-start uppercase tracking-wider font-mono">
                    {overlay.type?.replace("OverlayNode", "").replace("Node", "") || overlay.type}
                  </div>
                  <div className="text-[9px] text-indigo-200 bg-zinc-950/80 px-1 py-0.5 rounded self-end font-mono">
                    {overlay.x}%, {overlay.y}%
                  </div>

                  {/* Corner Handles */}
                  <div
                    onMouseDown={(e) => handleResizeMouseDown(e, overlay, "tl")}
                    className="absolute w-2.5 h-2.5 bg-white border-2 border-indigo-600 rounded-full shadow z-50 hover:bg-indigo-400 cursor-nwse-resize"
                    style={{ top: "-5px", left: "-5px" }}
                  />
                  <div
                    onMouseDown={(e) => handleResizeMouseDown(e, overlay, "tr")}
                    className="absolute w-2.5 h-2.5 bg-white border-2 border-indigo-600 rounded-full shadow z-50 hover:bg-indigo-400 cursor-nesw-resize"
                    style={{ top: "-5px", right: "-5px" }}
                  />
                  <div
                    onMouseDown={(e) => handleResizeMouseDown(e, overlay, "bl")}
                    className="absolute w-2.5 h-2.5 bg-white border-2 border-indigo-600 rounded-full shadow z-50 hover:bg-indigo-400 cursor-nesw-resize"
                    style={{ bottom: "-5px", left: "-5px" }}
                  />
                  <div
                    onMouseDown={(e) => handleResizeMouseDown(e, overlay, "br")}
                    className="absolute w-2.5 h-2.5 bg-white border-2 border-indigo-600 rounded-full shadow z-50 hover:bg-indigo-400 cursor-nwse-resize"
                    style={{ bottom: "-5px", right: "-5px" }}
                  />

                  {/* Side Handles */}
                  <div
                    onMouseDown={(e) => handleResizeMouseDown(e, overlay, "t")}
                    className="absolute w-2.5 h-2.5 bg-white border-2 border-indigo-600 rounded-full shadow z-50 hover:bg-indigo-400 cursor-ns-resize"
                    style={{ top: "-5px", left: "50%", transform: "translateX(-50%)" }}
                  />
                  <div
                    onMouseDown={(e) => handleResizeMouseDown(e, overlay, "b")}
                    className="absolute w-2.5 h-2.5 bg-white border-2 border-indigo-600 rounded-full shadow z-50 hover:bg-indigo-400 cursor-ns-resize"
                    style={{ bottom: "-5px", left: "50%", transform: "translateX(-50%)" }}
                  />
                  <div
                    onMouseDown={(e) => handleResizeMouseDown(e, overlay, "l")}
                    className="absolute w-2.5 h-2.5 bg-white border-2 border-indigo-600 rounded-full shadow z-50 hover:bg-indigo-400 cursor-ew-resize"
                    style={{ top: "50%", left: "-5px", transform: "translateY(-50%)" }}
                  />
                  <div
                    onMouseDown={(e) => handleResizeMouseDown(e, overlay, "r")}
                    className="absolute w-2.5 h-2.5 bg-white border-2 border-indigo-600 rounded-full shadow z-50 hover:bg-indigo-400 cursor-ew-resize"
                    style={{ top: "50%", right: "-5px", transform: "translateY(-50%)" }}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-zinc-400 text-center">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
          <span className="text-sm font-medium tracking-wide">
            Connecting to Screen Capture...
          </span>
          <span className="text-xs text-zinc-600">
            Initialising desktop audio and video pipeline
          </span>
        </div>
      )}

      {/* Floating Translucent Control Bar */}
      {stream && (
        <div 
          style={{ zIndex: 10000 }}
          className={`absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-zinc-950/80 backdrop-blur-md px-4 py-2.5 rounded-full border border-zinc-800 shadow-2xl transition-all duration-300 ${
            !isLocked ? "opacity-100 border-indigo-500/50 shadow-[0_0_20px_rgba(99,102,241,0.2)]" : "opacity-0 hover:opacity-100 group-hover:opacity-100"
          }`}
        >
          {/* Lock/Unlock layout positioning toggle button */}
          <button
            onClick={toggleLocked}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider cursor-pointer border transition-all ${
              !isLocked
                ? "bg-indigo-600 text-white border-indigo-500 shadow-[0_0_10px_rgba(99,102,241,0.5)] hover:bg-indigo-500"
                : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-white"
            }`}
          >
            {!isLocked ? (
              <>
                <Unlock className="w-3.5 h-3.5" /> Lock Layout
              </>
            ) : (
              <>
                <Lock className="w-3.5 h-3.5" /> Move Overlays
              </>
            )}
          </button>

          <div className="h-4 w-[1px] bg-zinc-800" />

          {/* Disk Capture Button */}
          <button
            onClick={isRecording ? stopRecording : startRecording}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider cursor-pointer border transition-all ${
              isRecording
                ? "bg-red-500/10 text-red-400 border-red-500/30 animate-pulse hover:bg-red-500/20"
                : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-white"
            }`}
          >
            {isRecording ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" /> Stop REC
              </>
            ) : (
              <>
                <Disc className="w-3.5 h-3.5" /> Record
              </>
            )}
          </button>

          <div className="h-4 w-[1px] bg-zinc-800" />

          {/* Streaming Button */}
          <button
            onClick={
              isStreaming
                ? stopStreaming
                : () => setShowStreamInput(!showStreamInput)
            }
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold uppercase tracking-wider cursor-pointer border transition-all ${
              isStreaming
                ? "bg-purple-500/10 text-purple-400 border-purple-500/30 animate-pulse hover:bg-purple-500/20"
                : "bg-zinc-900 text-zinc-300 border-zinc-800 hover:bg-zinc-800 hover:text-white"
            }`}
          >
            {isStreaming ? (
              <>
                <Square className="w-3.5 h-3.5 fill-current" /> Stop Stream
              </>
            ) : (
              <>
                <Radio className="w-3.5 h-3.5" /> Go Live
              </>
            )}
          </button>
        </div>
      )}

      {/* Stream Target Settings Popover */}
      {showStreamInput && (
        <div className="absolute bottom-20 left-1/2 -translate-x-1/2 w-80 p-4 bg-zinc-950 border border-zinc-800 rounded-xl shadow-2xl flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-200">
              RTMP Target URL
            </span>
            <span className="text-[10px] text-zinc-500">
              Provide server endpoint + stream key
            </span>
          </div>
          <input
            type="text"
            value={rtmpUrl}
            onChange={(e) => setRtmpUrl(cleanStreamUrl(e.target.value))}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
            placeholder="rtmp://..."
          />
          {rtmpUrl && !rtmpUrl.startsWith("rtmp://") && !rtmpUrl.startsWith("rtmps://") && (
            <span className="text-[10px] text-amber-500 font-semibold mt-0.5">
              Warning: Stream URL should start with rtmp:// or rtmps://
            </span>
          )}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setShowStreamInput(false)}
              className="text-xs px-2.5 py-1 text-zinc-400 hover:text-zinc-200 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={startStreaming}
              className="text-xs px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium cursor-pointer"
            >
              Start Stream
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
