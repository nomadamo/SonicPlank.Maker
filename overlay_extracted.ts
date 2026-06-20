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
        const edgeToVisualizer = edgesRef.current.find(
          (e) => e.target === overlay.id,
        );
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

        const W = Math.round(wVal);
        const H = Math.round(hVal);
        // Timer updates at 1-second resolution; progress bar at 1% resolution.
        const contentKey = `${W}|${H}|${overlay.title ?? ""}|${overlay.artist ?? ""}|${overlay.albumArt ?? ""}|${Math.floor(curTime)}|${Math.floor(pct * 100)}`;

        let npCache = nowPlayingCacheRef.current.get(overlay.id);
        const needsNewCanvas =
          !npCache || npCache.canvas.width !== W || npCache.canvas.height !== H;
        const needsRedraw =
          needsNewCanvas || !npCache || npCache.contentKey !== contentKey;

        if (needsRedraw) {
          const npCanvas = needsNewCanvas
            ? new OffscreenCanvas(W, H)
            : npCache.canvas;
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
            oc.fillStyle = "#ffffff";
            oc.textAlign = "left";
            oc.textBaseline = "top";
            oc.font = `bold ${artSize * 0.22}px Inter, sans-serif`;
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
            oc.font = `500 ${artSize * 0.16}px Inter, sans-serif`;
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
              oc.fillStyle = "#6366f1";
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
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        const r = Math.min(8, wVal * 0.02, hVal * 0.02);
        ctx.roundRect(xVal, yVal, wVal, hVal, r);
        ctx.fill();

        if (messages.length > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(xVal + padX, yVal + padY, wVal - padX * 2, hVal - padY * 2);
          ctx.clip();

          ctx.textBaseline = "top";
          const maxLines = Math.floor((hVal - padY * 2) / lineH);
          const contentW = wVal - padX * 2;

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
          let ty = yVal + hVal - padY - lineH;
          for (let i = rendered.length - 1; i >= 0; i--) {
            const { msg, prefix, prefixW, lines } = rendered[i];
            for (let li = lines.length - 1; li >= 0; li--) {
              if (li === 0) {
                ctx.fillStyle = msg.color || "#9147ff";
                ctx.fillText(prefix, xVal + padX, ty);
                ctx.fillStyle = "#ffffff";
                ctx.fillText(lines[li], xVal + padX + prefixW, ty);
              } else {
                ctx.fillStyle = "#ffffff";
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

