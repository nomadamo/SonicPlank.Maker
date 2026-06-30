import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";

export interface ApiAudioSource {
  name: string;
  volume: number;
  muted: boolean;
}

export interface ApiMediaState {
  playing: boolean;
  title: string;
  artist: string;
  source: "spotify" | "local";
}

export interface ApiScene {
  id: string;
  name: string;
}

export interface ApiState {
  streaming: boolean;
  recording: boolean;
  viewerCount: number;
  audioSources: ApiAudioSource[];
  media: ApiMediaState;
  activeSceneId: string;
  scenes: ApiScene[];
}

const state: ApiState = {
  streaming: false,
  recording: false,
  viewerCount: 0,
  audioSources: [],
  media: { playing: false, title: "", artist: "", source: "local" },
  activeSceneId: "",
  scenes: [],
};

let wss: WebSocketServer | null = null;
let httpServer: http.Server | null = null;
let dispatchToRenderer: ((channel: string, payload: unknown) => void) | null = null;

export function updateApiState(patch: Partial<ApiState>): void {
  Object.assign(state, patch);
}

export function broadcastWsEvent(event: string, data: unknown): void {
  if (!wss) return;
  const msg = JSON.stringify({ event, data });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg, () => { /* swallow send errors */ });
    }
  }
}

function parseBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => { raw += String(chunk); });
    req.on("end", () => {
      try { resolve(raw ? (JSON.parse(raw) as Record<string, unknown>) : {}); }
      catch { reject(new Error("Invalid JSON body")); }
    });
    req.on("error", reject);
  });
}

function reply(res: http.ServerResponse, status: number, data: unknown): void {
  const json = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  });
  res.end(json);
}

function dispatch(payload: unknown): void {
  dispatchToRenderer?.("apiCommand", payload);
}

async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = req.url ?? "/";
  const method = req.method?.toUpperCase() ?? "GET";

  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end();
    return;
  }

  try {
    // ── Streaming & Recording ─────────────────────────────────────────────────

    if (method === "GET" && url === "/api/streaming/status") {
      reply(res, 200, {
        streaming: state.streaming,
        recording: state.recording,
        viewerCount: state.viewerCount,
      });
      return;
    }

    if (method === "POST" && url === "/api/streaming/toggle") {
      const body = await parseBody(req);
      dispatch({ action: "toggleStream", platform: body.platform ?? "all" });
      reply(res, 200, { streaming: !state.streaming, platform: body.platform ?? "all" });
      return;
    }

    if (method === "POST" && url === "/api/recording/toggle") {
      const body = await parseBody(req);
      dispatch({ action: "toggleRecording", recordType: body.type ?? "stream" });
      reply(res, 200, { recording: !state.recording });
      return;
    }

    // ── Audio ─────────────────────────────────────────────────────────────────

    if (method === "GET" && url === "/api/audio/status") {
      reply(res, 200, { sources: state.audioSources });
      return;
    }

    if (method === "POST" && url === "/api/audio/mute/toggle") {
      const body = await parseBody(req);
      const source = String(body.source ?? "microphone");
      dispatch({ action: "toggleMute", source });
      const existing = state.audioSources.find((s) => s.name === source);
      reply(res, 200, { source, muted: existing ? !existing.muted : true });
      return;
    }

    if (method === "POST" && url === "/api/audio/volume") {
      const body = await parseBody(req);
      const source = String(body.source ?? "");
      const mode = String(body.mode ?? "set");
      const value = Number(body.value ?? 0);
      dispatch({ action: "setVolume", source, value, mode });
      const existing = state.audioSources.find((s) => s.name === source);
      const cur = existing?.volume ?? 1;
      let newVol: number;
      if (mode === "increment") newVol = Math.min(1, cur + value);
      else if (mode === "decrement") newVol = Math.max(0, cur - value);
      else newVol = Math.max(0, Math.min(1, value));
      reply(res, 200, { source, volume: newVol });
      return;
    }

    if (method === "POST" && url === "/api/audio/play-file") {
      const body = await parseBody(req);
      dispatch({ action: "playFile", filePath: body.filePath, volume: body.volume ?? 1 });
      reply(res, 200, {});
      return;
    }

    // ── Media ─────────────────────────────────────────────────────────────────

    if (method === "POST" && url === "/api/media/control") {
      const body = await parseBody(req);
      dispatch({ action: "mediaControl", mediaAction: body.action, player: body.player ?? "auto" });
      reply(res, 200, { playing: state.media.playing, player: body.player ?? "auto" });
      return;
    }

    if (method === "POST" && url === "/api/spotify/play-uri") {
      const body = await parseBody(req);
      dispatch({ action: "spotifyPlayUri", uri: body.uri });
      reply(res, 200, {});
      return;
    }

    // ── Scenes ───────────────────────────────────────────────────────────────

    if (method === "GET" && url === "/api/scenes") {
      reply(res, 200, { activeSceneId: state.activeSceneId, scenes: state.scenes });
      return;
    }

    if (method === "POST" && url === "/api/scenes/switch") {
      const body = await parseBody(req);
      const scene = String(body.scene ?? "");
      const durationMs = body.durationMs !== undefined ? Number(body.durationMs) : undefined;
      console.log(`[API] Scene switch requested: "${scene}"${durationMs !== undefined ? ` (${durationMs}ms)` : ""}`);
      dispatch({ action: "switchScene", scene, durationMs });
      reply(res, 200, { activeSceneId: state.activeSceneId, scenes: state.scenes });
      return;
    }

    if (method === "POST" && url === "/api/scenes/next") {
      const body = await parseBody(req);
      const durationMs = body.durationMs !== undefined ? Number(body.durationMs) : undefined;
      console.log(`[API] Scene next requested${durationMs !== undefined ? ` (${durationMs}ms)` : ""}`);
      dispatch({ action: "nextScene", durationMs });
      reply(res, 200, { activeSceneId: state.activeSceneId, scenes: state.scenes });
      return;
    }

    if (method === "POST" && url === "/api/scenes/prev") {
      const body = await parseBody(req);
      const durationMs = body.durationMs !== undefined ? Number(body.durationMs) : undefined;
      console.log(`[API] Scene prev requested${durationMs !== undefined ? ` (${durationMs}ms)` : ""}`);
      dispatch({ action: "prevScene", durationMs });
      reply(res, 200, { activeSceneId: state.activeSceneId, scenes: state.scenes });
      return;
    }

    reply(res, 404, { error: "Not found" });
  } catch (err) {
    console.error("[API] Request error:", err);
    reply(res, 500, { error: "Internal server error" });
  }
}

export function startApiServer(
  sendToRenderer: (channel: string, payload: unknown) => void,
  port = 8080,
): void {
  if (httpServer) return;
  dispatchToRenderer = sendToRenderer;

  httpServer = http.createServer((req, res) => {
    void handleRequest(req, res);
  });

  wss = new WebSocketServer({ server: httpServer, path: "/ws" });

  wss.on("connection", (ws) => {
    // Send current state to new connections
    const send = (event: string, data: unknown) =>
      ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify({ event, data }));
    send("streamState", { streaming: state.streaming, recording: state.recording, viewerCount: state.viewerCount });
    send("audioState", { sources: state.audioSources });
    send("mediaState", state.media);
    send("sceneState", { activeSceneId: state.activeSceneId, scenes: state.scenes });
  });

  httpServer.listen(port, "127.0.0.1", () => {
    console.log(`[API] Stream Deck API on http://127.0.0.1:${port} | ws://127.0.0.1:${port}/ws`);
  });

  httpServer.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[API] Port ${port} already in use — Stream Deck API unavailable`);
    } else {
      console.error("[API] Server error:", err);
    }
  });
}

export function stopApiServer(): void {
  wss?.close();
  httpServer?.close();
  wss = null;
  httpServer = null;
}
