import type { OverlayElement } from "@/types/flow-node";

// Pre-computed static frequency data shaped like a real spectrum
const MOCK_AUDIO = (() => {
  const d = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const base = Math.max(0, 1 - i / 48);
    const w1 = Math.sin(i * 1.7 + 1.2);
    const w2 = Math.cos(i * 0.8);
    d[i] = Math.round(255 * Math.max(0, Math.min(1, base * 0.75 + w1 * 0.2 + w2 * 0.12 + 0.1)));
  }
  return d;
})();

export const MOCK_NOW_PLAYING = {
  title: "Song Title",
  artist: "Artist Name",
  duration: 240,
  currentTime: 97,
};

export const MOCK_CHAT_MESSAGES = [
  { username: "viewer1", color: "#9147ff", message: "Great stream! 🔥" },
  { username: "viewer2", color: "#00c8af", message: "PogChamp" },
  { username: "viewer3", color: "#f97316", message: "Loving the vibes tonight!" },
];

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number): string[] {
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
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
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

const _imgCache = new Map<string, HTMLImageElement>();

/**
 * Renders a single OverlayElement synchronously into ctx, filling (0,0,W,H).
 * Uses mock data for live-data types (visualizer, nowPlaying, twitchChat).
 * Designed for static canvas previews — no RAF, no OffscreenCanvas.
 */
export function renderOverlayElementSnapshot(
  ctx: CanvasRenderingContext2D,
  el: OverlayElement,
  W: number,
  H: number,
): void {
  ctx.save();

  if (el.type === "color") {
    ctx.fillStyle = el.backgroundColor ?? "#7c3aed";
    ctx.fillRect(0, 0, W, H);

  } else if (el.type === "text") {
    const sizePx = Math.max(1, Math.round((el.fontSize ?? 5) * (H / 100)));
    ctx.font = `${el.fontStyle ?? "normal"} ${el.fontWeight ?? "normal"} ${sizePx}px ${el.fontFamily ?? "sans-serif"}`;
    ctx.fillStyle = el.textColor ?? "#ffffff";
    ctx.textBaseline = "top";
    ctx.fillText(el.textContent ?? "Text Overlay", 0, 0);

  } else if (el.type === "image") {
    if (el.imagePath) {
      let img = _imgCache.get(el.imagePath);
      if (!img) {
        img = new Image();
        img.src = el.imagePath.startsWith("http") || el.imagePath.startsWith("file://")
          ? el.imagePath : `file:///${el.imagePath.replace(/\\/g, "/")}`;
        _imgCache.set(el.imagePath, img);
      }
      if (img.complete && img.naturalWidth > 0) {
        ctx.drawImage(img, 0, 0, W, H);
      } else {
        _drawImagePlaceholder(ctx, W, H);
      }
    } else {
      _drawImagePlaceholder(ctx, W, H);
    }

  } else if (el.type === "visualizer") {
    _drawVisualizerSnapshot(ctx, el, W, H);

  } else if (el.type === "nowPlaying") {
    _drawNowPlayingSnapshot(ctx, el, W, H);

  } else if (el.type === "twitchChat") {
    _drawTwitchChatSnapshot(ctx, el, W, H);
  }

  ctx.restore();
}

function _drawImagePlaceholder(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = "#27272a";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#52525b";
  ctx.font = `${Math.min(W, H) * 0.3}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🖼", W / 2, H / 2);
}

function _drawVisualizerSnapshot(
  ctx: CanvasRenderingContext2D,
  el: OverlayElement,
  W: number,
  H: number,
) {
  const vType = el.visualizerType ?? "bars";
  const data = MOCK_AUDIO;
  const bufLen = data.length;

  ctx.fillStyle = el.backgroundColor ?? "rgba(0,0,0,0.3)";
  ctx.fillRect(0, 0, W, H);

  if (vType === "wave") {
    ctx.strokeStyle = el.barColor ?? "#06b6d4";
    ctx.lineWidth = Math.max(1, H * 0.025);
    ctx.beginPath();
    const sliceW = W / bufLen;
    for (let i = 0; i < bufLen; i++) {
      const ly = (data[i] / 128.0) * H / 2;
      if (i === 0) ctx.moveTo(0, ly); else ctx.lineTo(i * sliceW, ly);
    }
    ctx.stroke();
  } else if (vType === "circle") {
    const cx = W / 2, cy = H / 2;
    const baseR = Math.min(W, H) * 0.15;
    const maxR  = Math.min(W, H) * 0.45;
    const step = Math.max(1, Math.floor(bufLen / 80));
    const NUM_BANDS = 8;
    for (let band = 0; band < NUM_BANDS; band++) {
      ctx.strokeStyle = `hsl(${180 + (band / NUM_BANDS) * 80}, 85%, 55%)`;
      ctx.lineWidth = Math.max(1, H * 0.02);
      ctx.beginPath();
      const bStart = Math.round((band / NUM_BANDS) * bufLen);
      const bEnd   = Math.round(((band + 1) / NUM_BANDS) * bufLen);
      for (let i = bStart; i < bEnd; i += step) {
        const angle = (i / bufLen) * Math.PI * 2;
        const r = baseR + (data[i] / 255) * (maxR - baseR);
        ctx.moveTo(cx + Math.cos(angle) * baseR, cy + Math.sin(angle) * baseR);
        ctx.lineTo(cx + Math.cos(angle) * r,     cy + Math.sin(angle) * r);
      }
      ctx.stroke();
    }
  } else if (vType === "blocks") {
    const numBlocksY = 8;
    const step = Math.max(1, Math.floor(bufLen / 40));
    const displayCount = Math.floor(bufLen / step);
    const barW   = W / displayCount;
    const blockH = H / numBlocksY - 1.5;
    let posX = 0;
    for (let i = 0; i < bufLen; i += step) {
      const blocks = Math.round((data[i] / 255) * numBlocksY);
      for (let j = 0; j < blocks; j++) {
        ctx.fillStyle = j < numBlocksY * 0.4 ? "#6366f1" : j < numBlocksY * 0.75 ? "#3b82f6" : "#06b6d4";
        ctx.fillRect(posX, H - (j + 1) * (blockH + 1.5), barW - 1.5, blockH);
      }
      posX += barW;
    }
  } else if (vType === "dots") {
    const dotCount = 24;
    const spacing = W / dotCount;
    ctx.fillStyle = el.barColor ?? "#06b6d4";
    for (let i = 0; i < dotCount; i++) {
      const amp = data[Math.floor((i / dotCount) * bufLen)] / 255;
      ctx.beginPath();
      ctx.arc(i * spacing + spacing / 2, H - amp * H, Math.max(2, amp * Math.min(W, H) * 0.05), 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // bars (default)
    const barW = (W / bufLen) * 1.5;
    const grad = ctx.createLinearGradient(0, H, 0, 0);
    grad.addColorStop(0, el.barColor ?? "#6366f1");
    grad.addColorStop(1, "#06b6d4");
    ctx.fillStyle = grad;
    let posX = 0;
    for (let i = 0; i < bufLen; i++) {
      const bH = (data[i] / 255) * H;
      ctx.fillRect(posX, H - bH, barW - 1, bH);
      posX += barW + 1;
      if (posX >= W) break;
    }
  }
}

function _drawNowPlayingSnapshot(
  ctx: CanvasRenderingContext2D,
  el: OverlayElement,
  W: number,
  H: number,
) {
  const pct = MOCK_NOW_PLAYING.currentTime / MOCK_NOW_PLAYING.duration;
  const pad     = H * 0.12;
  const artSize = H - pad * 2;
  const artX    = pad;
  const artY    = pad;
  const textX   = artX + artSize + pad;
  const titleY  = pad + artSize * 0.12;
  const artistY = pad + artSize * 0.48;

  // Card background
  drawRoundedRect(ctx, 0, 0, W, H, H * 0.15);
  ctx.fillStyle   = el.backgroundColor ?? "rgba(12,12,12,0.85)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth   = 1;
  ctx.stroke();

  // Album art placeholder (gradient)
  ctx.save();
  drawRoundedRect(ctx, artX, artY, artSize, artSize, artSize * 0.12);
  ctx.clip();
  const grad = ctx.createLinearGradient(artX, artY, artX + artSize, artY + artSize);
  grad.addColorStop(0, "#4f46e5");
  grad.addColorStop(1, "#06b6d4");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.fillStyle    = "#ffffff";
  ctx.font         = `${artSize * 0.4}px sans-serif`;
  ctx.textAlign    = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("🎵", artX + artSize / 2, artY + artSize / 2);
  ctx.restore();

  const maxTextW = W - (pad * 3 + artSize) - pad;

  // Title
  const cardFont = el.fontFamily ? `${el.fontFamily}, sans-serif` : "Inter, sans-serif";
  ctx.fillStyle    = el.textColor ?? "#ffffff";
  ctx.textAlign    = "left";
  ctx.textBaseline = "top";
  ctx.font = `bold ${Math.max(1, artSize * 0.22)}px ${cardFont}`;
  let title = MOCK_NOW_PLAYING.title;
  if (ctx.measureText(title).width > maxTextW) {
    while (title.length > 0 && ctx.measureText(title + "...").width > maxTextW) title = title.slice(0, -1);
    title += "...";
  }
  ctx.fillText(title, textX, titleY);

  // Artist
  ctx.fillStyle = "#a1a1aa";
  ctx.font = `500 ${Math.max(1, artSize * 0.16)}px ${cardFont}`;
  let artist = MOCK_NOW_PLAYING.artist;
  if (ctx.measureText(artist).width > maxTextW) {
    while (artist.length > 0 && ctx.measureText(artist + "...").width > maxTextW) artist = artist.slice(0, -1);
    artist += "...";
  }
  ctx.fillText(artist, textX, artistY);

  // Progress bar
  const progressY   = H - pad * 1.6;
  const timerSpace  = artSize * 0.75;
  const barW        = Math.max(10, W - (pad * 3 + artSize) - timerSpace - pad * 2);
  ctx.fillStyle = "rgba(255,255,255,0.1)";
  ctx.beginPath();
  drawRoundedRect(ctx, textX, progressY, barW, H * 0.04, H * 0.02);
  ctx.fill();
  if (pct > 0) {
    ctx.fillStyle = el.progressColor ?? "#6366f1";
    ctx.beginPath();
    drawRoundedRect(ctx, textX, progressY, barW * pct, H * 0.04, H * 0.02);
    ctx.fill();
  }

  // Timer
  ctx.fillStyle    = "#a1a1aa";
  ctx.font         = `500 ${Math.max(1, artSize * 0.14)}px monospace`;
  ctx.textAlign    = "right";
  ctx.textBaseline = "middle";
  ctx.fillText(
    `${formatTime(MOCK_NOW_PLAYING.currentTime)} / ${formatTime(MOCK_NOW_PLAYING.duration)}`,
    W - pad,
    progressY + H * 0.02,
  );
}

function _drawTwitchChatSnapshot(
  ctx: CanvasRenderingContext2D,
  el: OverlayElement,
  W: number,
  H: number,
) {
  const sizePx = Math.max(8, Math.round((el.fontSize ?? 2.5) * (H / 100)));
  ctx.font = `${el.fontStyle ?? "normal"} ${el.fontWeight ?? "normal"} ${sizePx}px ${el.fontFamily ?? "sans-serif"}`;

  const lineH  = Math.round(sizePx * 1.5);
  const padX   = Math.round(sizePx * 0.6);
  const padY   = Math.round(sizePx * 0.5);

  ctx.fillStyle = el.backgroundColor ?? "rgba(0,0,0,0.55)";
  const r = Math.min(8, W * 0.02, H * 0.02);
  ctx.beginPath();
  ctx.roundRect(0, 0, W, H, r);
  ctx.fill();

  ctx.save();
  ctx.beginPath();
  ctx.rect(padX, padY, W - padX * 2, H - padY * 2);
  ctx.clip();
  ctx.textBaseline = "top";

  const maxLines = Math.floor((H - padY * 2) / lineH);
  const contentW = W - padX * 2;
  const messages = MOCK_CHAT_MESSAGES;

  type RM = { color: string; prefix: string; prefixW: number; lines: string[] };
  const rendered: RM[] = [];
  let totalLines = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg    = messages[i];
    const prefix = `${msg.username}: `;
    const prefixW = ctx.measureText(prefix).width;
    const lines   = wrapText(ctx, msg.message, Math.max(1, contentW - prefixW));
    if (totalLines + lines.length > maxLines) break;
    totalLines += lines.length;
    rendered.unshift({ color: msg.color, prefix, prefixW, lines });
  }

  let ty = H - padY - lineH;
  for (let i = rendered.length - 1; i >= 0; i--) {
    const { color, prefix, prefixW, lines } = rendered[i];
    for (let li = lines.length - 1; li >= 0; li--) {
      if (li === 0) {
        ctx.fillStyle = color;
        ctx.fillText(prefix, padX, ty);
        ctx.fillStyle = el.textColor ?? "#ffffff";
        ctx.fillText(lines[li], padX + prefixW, ty);
      } else {
        ctx.fillStyle = el.textColor ?? "#ffffff";
        ctx.fillText(lines[li], padX + prefixW, ty);
      }
      ty -= lineH;
    }
  }
  ctx.restore();
}
