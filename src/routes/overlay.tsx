import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useCallback } from "react";
import { OverlayElement } from "@/types/flow-node";
import { chatMessagesStore, type ChatMessage } from "@/store/chatMessagesStore";

export const Route = createFileRoute("/overlay")({
  component: OverlayWindowComponent,
});

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
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function OverlayWindowComponent() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isTransitioningRef = useRef(false);
  const pendingOverlaysRef = useRef<OverlayElement[] | null>(null);
  const transitionTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeOutHandlerRef = useRef<((e: TransitionEvent) => void) | null>(null);
  const overlaysRef = useRef<OverlayElement[]>([]);
  const audioDataMapRef = useRef<Record<string, number[]>>({});
  const audioTimesRef = useRef<Record<string, { currentTime: number; duration: number }>>({});
  
  const textFontCacheRef = useRef<Map<string, { key: string; fontStr: string }>>(new Map());
  const cardImageCacheRef = useRef<Record<string, HTMLImageElement>>({});
  const nowPlayingCacheRef = useRef<Map<string, { canvas: OffscreenCanvas; contentKey: string }>>(new Map());
  const visualizerCachesRef = useRef<Map<string, { canvas: OffscreenCanvas; ctx2d: OffscreenCanvasRenderingContext2D; lastDrawn: number; dataArray: Uint8Array; barsGrad: CanvasGradient | null; barsGradH: number; }>>(new Map());

  const lastAudioBroadcastRef = useRef<number>(0);
  const requestRef = useRef<number | null>(null);
  // Gate: don't paint blank frames while the initial getOverlays() IPC is in flight.
  const overlaysReadyRef = useRef(false);

  // Offscreen rendering needs explicit transparent background — Chromium won't
  // clear to transparent on its own without these styles.
  useEffect(() => {
    document.body.style.background = "transparent";
    document.documentElement.style.background = "transparent";
  }, []);

  // Sync state via IPC
  useEffect(() => {
    window.electron.getOverlays()
      .then((initial) => {
        if (initial) overlaysRef.current = initial;
        overlaysReadyRef.current = true;
      })
      .catch(() => { overlaysReadyRef.current = true; });

    // Populate chat store with any messages received before this window loaded
    window.electron.getChatMessages()
      .then((msgs) => {
        for (const [nodeId, messages] of Object.entries(msgs)) {
          chatMessagesStore.set(nodeId, messages);
        }
      })
      .catch(() => {});

    window.electron.onOverlaysUpdated((updated) => {
      overlaysReadyRef.current = true;
      if (isTransitioningRef.current) {
        // Fade-out in progress — hold the new data until the fade-out completes.
        pendingOverlaysRef.current = updated ?? [];
      } else {
        overlaysRef.current = updated ?? [];
      }
    });

    window.electron.onSceneSwitch((event) => {
      const container = containerRef.current;

      // Always cancel any prior in-flight transition first
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
        transitionTimeoutRef.current = null;
      }
      if (container && fadeOutHandlerRef.current) {
        container.removeEventListener("transitionend", fadeOutHandlerRef.current);
        fadeOutHandlerRef.current = null;
      }

      // Instant switch — reset state and apply any queued overlays
      if (!event.durationMs || !container) {
        if (container) {
          container.style.transition = "none";
          container.style.opacity = "1";
        }
        isTransitioningRef.current = false;
        if (pendingOverlaysRef.current !== null) {
          overlaysRef.current = pendingOverlaysRef.current;
          pendingOverlaysRef.current = null;
        }
        return;
      }

      isTransitioningRef.current = true;
      pendingOverlaysRef.current = null;

      container.style.transition = `opacity ${event.durationMs}ms ease-in-out`;
      container.style.opacity = "0";

      const finishTransition = () => {
        if (fadeOutHandlerRef.current) {
          container.removeEventListener("transitionend", fadeOutHandlerRef.current);
          fadeOutHandlerRef.current = null;
        }
        if (transitionTimeoutRef.current) {
          clearTimeout(transitionTimeoutRef.current);
          transitionTimeoutRef.current = null;
        }
        if (pendingOverlaysRef.current !== null) {
          overlaysRef.current = pendingOverlaysRef.current;
          pendingOverlaysRef.current = null;
        }
        isTransitioningRef.current = false;
        container.style.opacity = "1";
      };

      const onFadeOut = (e: TransitionEvent) => {
        if (e.target !== container || e.propertyName !== "opacity") return;
        finishTransition();
      };

      fadeOutHandlerRef.current = onFadeOut;
      container.addEventListener("transitionend", onFadeOut);

      // Fallback: force completion if transitionend never fires in offscreen mode
      transitionTimeoutRef.current = setTimeout(finishTransition, event.durationMs + 100);
    });

    window.electron.onAudioDataUpdated((id, data) => {
      audioDataMapRef.current[id] = data;
    });

    window.electron.onAudioTimeUpdated((nodeId, currentTime) => {
      const overlay = overlaysRef.current.find((o) => o.audioNodeId === nodeId && o.type === "nowPlaying");
      const duration = overlay?.duration !== undefined ? Number(overlay.duration) : 0;
      audioTimesRef.current[nodeId] = { currentTime, duration };
    });

    window.electron.onChatMessagesUpdated((nodeId, messages) => {
      chatMessagesStore.set(nodeId, messages);
    });

    // Periodic resync: pull cached messages from main every 2s so chat
    // appears even if the push event was missed (e.g. arrived before mount).
    const chatSyncInterval = setInterval(() => {
      if (!overlaysRef.current.some((o) => o.type === "twitchChat")) return;
      window.electron.getChatMessages()
        .then((msgs) => {
          for (const [nodeId, messages] of Object.entries(msgs)) {
            chatMessagesStore.set(nodeId, messages);
          }
        })
        .catch(() => {});
    }, 2000);

    return () => {
      clearInterval(chatSyncInterval);
      if (transitionTimeoutRef.current) clearTimeout(transitionTimeoutRef.current);
      if (containerRef.current && fadeOutHandlerRef.current) {
        containerRef.current.removeEventListener("transitionend", fadeOutHandlerRef.current);
        fadeOutHandlerRef.current = null;
      }
      window.electron.removeOnOverlaysUpdated(() => {});
      window.electron.removeOnAudioDataUpdated();
      window.electron.removeOnAudioTimeUpdated();
      window.electron.removeOnChatMessagesUpdated();
      window.electron.removeOnSceneSwitch();
    };
  }, []);

  const renderLoop = useCallback(() => {
    requestRef.current = requestAnimationFrame(renderLoop);
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    // Size canvas to window
    if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    }
    
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Hold the previous frame if overlays haven't loaded yet or are transiently
    // empty — prevents the 10fps SHM paint from capturing a blank canvas.
    if (!overlaysReadyRef.current || overlaysRef.current.length === 0) return;

    // Clear canvas - transparent background!
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const now = performance.now();

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
        const r = Math.min(wVal, hVal) * ((overlay.borderRadius ?? 0) / 100);
        ctx.fillStyle = overlay.backgroundColor;
        if (r > 0) {
          ctx.beginPath();
          ctx.roundRect(xVal, yVal, wVal, hVal, r);
          ctx.fill();
        } else {
          ctx.fillRect(xVal, yVal, wVal, hVal);
        }
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
        const align = overlay.textAlign || "left";
        const drawX = align === "center" ? xVal + wVal / 2 : align === "right" ? xVal + wVal : xVal;
        ctx.font = fontEntry.fontStr;
        ctx.fillStyle = overlay.textColor || "#ffffff";
        ctx.textAlign = align;
        ctx.textBaseline = "top";
        ctx.save();
        ctx.rect(xVal, yVal, wVal, hVal);
        ctx.clip();
        const lines = overlay.textContent.split("\n");
        const lineH = sizePx * 1.25;
        lines.forEach((line, i) => ctx.fillText(line, drawX, yVal + i * lineH));
        ctx.restore();
        ctx.textAlign = "left"; // reset to default
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
          // object-contain: scale to fit within bounds, centered, preserving aspect ratio
          const imgAspect = img.naturalWidth / img.naturalHeight;
          const boxAspect = wVal / hVal;
          let dw: number, dh: number, dx: number, dy: number;
          if (imgAspect > boxAspect) {
            dw = wVal; dh = wVal / imgAspect;
            dx = xVal; dy = yVal + (hVal - dh) / 2;
          } else {
            dh = hVal; dw = hVal * imgAspect;
            dy = yVal; dx = xVal + (wVal - dw) / 2;
          }
          const r = Math.min(dw, dh) * ((overlay.borderRadius ?? 0) / 100);
          if (r > 0) {
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(dx, dy, dw, dh, r);
            ctx.clip();
            ctx.drawImage(img, dx, dy, dw, dh);
            ctx.restore();
          } else {
            ctx.drawImage(img, dx, dy, dw, dh);
          }
        }
      } else if (overlay.type === "blur") {
        // Capture current canvas state, apply blur, clip to element bounds
        const offscreen = new OffscreenCanvas(canvas.width, canvas.height);
        const offCtx = offscreen.getContext("2d")!;
        offCtx.drawImage(canvas, 0, 0);
        const blurPx = (overlay.blurRadius ?? 10) * (canvas.height / 1080);
        ctx.save();
        ctx.beginPath();
        ctx.rect(xVal, yVal, wVal, hVal);
        ctx.clip();
        ctx.filter = `blur(${blurPx}px)`;
        ctx.drawImage(offscreen, 0, 0);
        ctx.filter = "none";
        ctx.restore();
      } else if (overlay.type === "visualizer") {
        // We receive raw audio data via IPC
        const rawAudioData = audioDataMapRef.current[overlay.id];
        if (rawAudioData) {

          const vType = overlay.visualizerType || "bars";
          const bufferLength = rawAudioData.length;

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
              barsGrad: null,
              barsGradH: -1,
            };
            visualizerCachesRef.current.set(overlay.id, cache);
          }
          if (!cache) return;

          // Only sample audio data when we're about to redraw or broadcast.
          const needsRedraw = now - cache.lastDrawn >= 33 || needsResize;
          if (needsRedraw) {
            // IPC audio data is already 0-255 scale
            for (let i = 0; i < rawAudioData.length; i++) {
               cache.dataArray[i] = rawAudioData[i];
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
                  cache.dataArray[Math.floor((i / dotCount) * bufferLength)] /
                  255;
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

        const W = Math.max(1, Math.round(wVal));
        const H = Math.max(1, Math.round(hVal));
        // Timer updates at 1-second resolution; progress bar at 1% resolution.
        // Style props included so cache invalidates when theme colors change.
        const contentKey = `${W}|${H}|${overlay.title ?? ""}|${overlay.artist ?? ""}|${overlay.albumArt ?? ""}|${Math.floor(curTime)}|${Math.floor(pct * 100)}|${overlay.backgroundColor ?? ""}|${overlay.textColor ?? ""}|${overlay.progressColor ?? ""}|${overlay.fontFamily ?? ""}`;

        let npCache = nowPlayingCacheRef.current.get(overlay.id);
        const needsNewCanvas =
          !npCache || npCache.canvas.width !== W || npCache.canvas.height !== H;
        const needsRedraw =
          needsNewCanvas || !npCache || npCache.contentKey !== contentKey;

        if (needsRedraw) {
          const npCanvas = needsNewCanvas
            ? new OffscreenCanvas(W, H)
            : npCache!.canvas;
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
            oc.fillStyle = overlay.backgroundColor || "rgba(12,12,12,0.85)";
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
              const grad = oc.createLinearGradient(
                artX,
                artY,
                artX + artSize,
                artY + artSize,
              );
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
            const cardFont = overlay.fontFamily || "Inter, sans-serif";
            oc.fillStyle = overlay.textColor || "#ffffff";
            oc.textAlign = "left";
            oc.textBaseline = "top";
            oc.font = `bold ${artSize * 0.22}px ${cardFont}`;
            let displayTitle = overlay.title || "No Track Connected";
            if (oc.measureText(displayTitle).width > maxTextWidth) {
              while (
                displayTitle.length > 0 &&
                oc.measureText(displayTitle + "...").width > maxTextWidth
              ) {
                displayTitle = displayTitle.slice(0, -1);
              }
              displayTitle += "...";
            }
            oc.fillText(displayTitle, textX, titleY);

            // Artist
            oc.fillStyle = "#a1a1aa";
            oc.font = `500 ${artSize * 0.16}px ${cardFont}`;
            let displayArtist = overlay.artist || "Connect Audio Source";
            if (oc.measureText(displayArtist).width > maxTextWidth) {
              while (
                displayArtist.length > 0 &&
                oc.measureText(displayArtist + "...").width > maxTextWidth
              ) {
                displayArtist = displayArtist.slice(0, -1);
              }
              displayArtist += "...";
            }
            oc.fillText(displayArtist, textX, artistY);

            // Progress bar
            const progressY = H - pad * 1.6;
            const timerSpace = artSize * 0.75;
            const barW = Math.max(
              10,
              W - (pad * 3 + artSize) - timerSpace - pad * 2,
            );
            oc.fillStyle = "rgba(255, 255, 255, 0.1)";
            oc.beginPath();
            drawRoundedRect(oc, textX, progressY, barW, H * 0.04, H * 0.02);
            oc.fill();
            if (pct > 0) {
              oc.fillStyle = overlay.progressColor || "#6366f1";
              oc.beginPath();
              drawRoundedRect(
                oc,
                textX,
                progressY,
                barW * pct,
                H * 0.04,
                H * 0.02,
              );
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
      } else if (overlay.type === "twitchChat") {
        const messages = chatMessagesStore.get(overlay.id) ?? [];

        const sizePx = Math.max(
          8,
          Math.round((overlay.fontSize || 2.5) * (canvas.height / 100)),
        );
        const fontStr = `${overlay.fontStyle || "normal"} ${overlay.fontWeight || "normal"} ${sizePx}px ${overlay.fontFamily || "Inter, sans-serif"}`;
        ctx.font = fontStr;

        const lineH = Math.round(sizePx * 1.5);
        const padX = Math.round(sizePx * 0.6);
        const padY = Math.round(sizePx * 0.5);

        // Semi-transparent background
        ctx.fillStyle = overlay.backgroundColor || "rgba(0,0,0,0.55)";
        ctx.beginPath();
        const r = Math.min(8, wVal * 0.02, hVal * 0.02);
        ctx.roundRect(xVal, yVal, wVal, hVal, r);
        ctx.fill();

        const maxLines = Math.floor((hVal - padY * 2) / lineH);
        const contentW = wVal - padX * 2;

        if (messages.length > 0 && maxLines > 0 && contentW > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(xVal + padX, yVal + padY, contentW, hVal - padY * 2);
          ctx.clip();

          ctx.textBaseline = "top";

          // Pre-compute wrapped lines newest-first until we fill the box
          type RenderedMsg = {
            msg: ChatMessage;
            prefix: string;
            prefixW: number;
            lines: string[];
          };
          const rendered: RenderedMsg[] = [];
          let totalLines = 0;
          for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            const prefix = `${msg.username}: `;
            const prefixW = ctx.measureText(prefix).width;
            const lines = wrapText(
              ctx,
              msg.message,
              Math.max(1, contentW - prefixW),
            );
            if (totalLines + lines.length > maxLines) break;
            totalLines += lines.length;
            rendered.unshift({ msg, prefix, prefixW, lines });
          }

          // Draw bottom-up
          const chatTextColor = overlay.textColor || "#ffffff";
          let ty = yVal + hVal - padY - lineH;
          for (let i = rendered.length - 1; i >= 0; i--) {
            const { msg, prefix, prefixW, lines } = rendered[i];
            for (let li = lines.length - 1; li >= 0; li--) {
              if (li === 0) {
                ctx.fillStyle = msg.color || "#9147ff";
                ctx.fillText(prefix, xVal + padX, ty);
                ctx.fillStyle = chatTextColor;
                ctx.fillText(lines[li], xVal + padX + prefixW, ty);
              } else {
                ctx.fillStyle = chatTextColor;
                ctx.fillText(lines[li], xVal + padX + prefixW, ty);
              }
              ty -= lineH;
            }
          }

          ctx.restore();
        }
      }

      ctx.restore();
    });


  }, []);

  useEffect(() => {
    requestRef.current = requestAnimationFrame(renderLoop);
    return () => {
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, [renderLoop]);

  return (
    <div ref={containerRef} className="fixed inset-0 pointer-events-none" style={{ opacity: 1 }}>
      <canvas ref={canvasRef} className="w-full h-full" />
    </div>
  );
}
