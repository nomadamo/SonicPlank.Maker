import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState, useCallback } from "react";
import { useScreenCapture } from "@/hooks/useScreenCapture";
import { Loader2, Radio, Disc, Square, Monitor } from "lucide-react";
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

  // Subscribe to real-time audio data from the main window compositor
  useEffect(() => {
    window.electron.onAudioDataUpdated((visualizerId, dataArray) => {
      audioDataMapRef.current[visualizerId] = dataArray;
    });
    return () => {
      window.electron.removeOnAudioDataUpdated();
    };
  }, []);

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

    let options = { mimeType: "video/webm;codecs=h264" };
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: "video/webm;codecs=vp9" };
    }
    if (!MediaRecorder.isTypeSupported(options.mimeType)) {
      options = { mimeType: "video/webm" };
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
        <canvas
          ref={canvasRef}
          className="max-w-full max-h-full object-contain"
          style={{ aspectRatio: aspectValue }}
        />
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
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-zinc-950/80 backdrop-blur-md px-4 py-2.5 rounded-full border border-zinc-800 shadow-2xl opacity-0 hover:opacity-100 group-hover:opacity-100 transition-all duration-300">
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
            onChange={(e) => setRtmpUrl(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded px-2.5 py-1.5 text-xs text-zinc-200 focus:border-indigo-500 focus:outline-none"
            placeholder="rtmp://..."
          />
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
