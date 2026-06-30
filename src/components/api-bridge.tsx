import { useEffect, useRef } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { isStreamingAtom, apiCommandAtom, flowDataAtom } from "@/store/flowStore";
import { spotifyAtom } from "@/store/libraryStore";
import type { SpotifyApi } from "@spotify/web-api-ts-sdk";
import type { ApiState } from "@/api-server";
import type { OverlayThemeLayout } from "@/types/flow-node";

let globalCmdId = 0;

export function ApiBridge() {
  const isStreaming = useAtomValue(isStreamingAtom);
  const flowData = useAtomValue(flowDataAtom);
  const spotify = useAtomValue(spotifyAtom);
  const setApiCommand = useSetAtom(apiCommandAtom);
  const flowDataRef = useRef(flowData);
  flowDataRef.current = flowData;

  // Derive recording state from the first targetOutputNode's isRecording flag
  const isRecording = flowData.nodes.some(
    (n) => n.type === "targetOutputNode" && (n.data.isRecording as boolean | undefined),
  );

  // Build audio sources list from audioSourceNodes
  const audioSources = flowData.nodes
    .filter((n) => n.type === "audioSourceNode")
    .map((n) => ({
      name: String(n.data.audioDeviceName ?? n.id),
      volume: Number(n.data.volume ?? 1),
      muted: Boolean(n.data.isMuted),
    }));

  // Sync streaming + recording state to main process
  useEffect(() => {
    window.electron.sendApiStateUpdate({ streaming: isStreaming, recording: isRecording });
  }, [isStreaming, isRecording]);

  // Sync audio sources state to main process
  useEffect(() => {
    window.electron.sendApiStateUpdate({ audioSources });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(audioSources)]);

  // Derive scene state — prefer embedded theme in output node, fall back to legacy overlayThemeNode
  const sceneSourceNode =
    flowData.nodes.find((n) => n.type === "targetOutputNode" && n.data.themeLayout) ??
    flowData.nodes.find((n) => n.type === "overlayThemeNode");
  const sceneThemeLayout = (sceneSourceNode?.data.themeLayout as OverlayThemeLayout | null) ?? null;
  const activeSceneId = (sceneSourceNode?.data.activeSceneId as string) ?? "";
  const sceneList = sceneThemeLayout?.scenes?.map((s) => ({ id: s.id, name: s.name })) ?? [];

  useEffect(() => {
    window.electron.sendApiStateUpdate({ activeSceneId, scenes: sceneList });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSceneId, JSON.stringify(sceneList)]);

  // Wire incoming API commands from main → apiCommandAtom
  useEffect(() => {
    window.electron.onApiCommand((raw: Record<string, unknown>) => {
      const action = String(raw.action ?? "");

      // Handle Spotify media commands directly here since we have the SDK reference
      if ((action === "mediaControl" || action === "spotifyPlayUri") && spotify) {
        void handleSpotifyCommand(action, raw, spotify).then((mediaState) => {
          if (mediaState) window.electron.sendApiStateUpdate({ media: mediaState });
        });
        return;
      }

      // Scene commands: if a legacy overlayThemeNode exists, handle directly via triggerSceneSwitch.
      // Otherwise fall through to apiCommandAtom — the targetOutputNode handles them for embedded themes.
      if (action === "switchScene" || action === "nextScene" || action === "prevScene") {
        const legacyThemeNode = flowDataRef.current.nodes.find((n) => n.type === "overlayThemeNode");
        if (legacyThemeNode) {
          void handleSceneCommand(action, raw, flowDataRef.current);
          return;
        }
      }

      // All other commands (toggleStream, toggleRecording, toggleMute, setVolume, playFile)
      // are forwarded to target-output-node / audio nodes via the atom
      const { action: _a, ...rest } = raw;
      setApiCommand({
        action,
        id: ++globalCmdId,
        payload: rest as Record<string, unknown>,
      });
    });

    return () => {
      window.electron.removeOnApiCommand();
    };
  }, [setApiCommand, spotify]);

  return null;
}

async function handleSceneCommand(
  action: string,
  raw: Record<string, unknown>,
  flowData: { nodes: { id: string; type?: string | null; data: Record<string, unknown> }[] },
): Promise<void> {
  const themeNode = flowData.nodes.find((n) => n.type === "overlayThemeNode");
  if (!themeNode) return;

  const layout = themeNode.data.themeLayout as OverlayThemeLayout | null;
  if (!layout?.scenes?.length) return;

  const activeSceneId = String(themeNode.data.activeSceneId ?? layout.scenes[0].id);
  const scenes = layout.scenes;
  const currentIdx = scenes.findIndex((s) => s.id === activeSceneId);

  let targetScene: typeof scenes[number] | undefined;

  if (action === "switchScene") {
    const query = String(raw.scene ?? "");
    targetScene = scenes.find((s) => s.id === query || s.name.toLowerCase() === query.toLowerCase());
  } else if (action === "nextScene") {
    const nextIdx = currentIdx < 0 ? 0 : (currentIdx + 1) % scenes.length;
    targetScene = scenes[nextIdx];
  } else if (action === "prevScene") {
    const prevIdx = currentIdx <= 0 ? scenes.length - 1 : currentIdx - 1;
    targetScene = scenes[prevIdx];
  }

  if (!targetScene) {
    console.warn(`[ApiBridge] Scene command "${action}" — no matching scene for query:`, raw.scene ?? "(none)");
    return;
  }
  if (targetScene.id === activeSceneId) {
    console.log(`[ApiBridge] Scene "${targetScene.name}" is already active — no switch needed`);
    return;
  }

  const durationMs = raw.durationMs !== undefined
    ? Number(raw.durationMs)
    : (targetScene.transition?.durationMs ?? 500);

  console.log(`[ApiBridge] Switching scene → "${targetScene.name}" (${targetScene.id}) in ${durationMs}ms`);
  await window.electron.triggerSceneSwitch({ nodeId: themeNode.id, sceneId: targetScene.id, durationMs });
}

async function handleSpotifyCommand(
  action: string,
  raw: Record<string, unknown>,
  spotify: SpotifyApi,
): Promise<ApiState["media"] | null> {
  try {
    if (action === "spotifyPlayUri") {
      const uri = String(raw.uri ?? "");
      if (uri) await spotify.player.startResumePlayback("", undefined, [uri]);
      return null;
    }

    if (action === "mediaControl") {
      const mediaAction = String(raw.mediaAction ?? raw.action ?? "toggle");
      const player = String(raw.player ?? "auto");
      if (player !== "spotify" && player !== "auto") return null;

      if (mediaAction === "play") await spotify.player.startResumePlayback("");
      else if (mediaAction === "pause") await spotify.player.pausePlayback("");
      else if (mediaAction === "next") await spotify.player.skipToNext("");
      else if (mediaAction === "prev") await spotify.player.skipToPrevious("");
      else if (mediaAction === "toggle") {
        const pb = await spotify.player.getPlaybackState();
        if (pb?.is_playing) await spotify.player.pausePlayback("");
        else await spotify.player.startResumePlayback("");
      }

      // Fetch updated state
      await new Promise<void>((r) => setTimeout(r, 300));
      const pb = await spotify.player.getPlaybackState();
      if (!pb) return null;
      const track = pb.item as { name?: string; artists?: { name: string }[] } | null;
      return {
        playing: pb.is_playing,
        title: track?.name ?? "",
        artist: track?.artists?.[0]?.name ?? "",
        source: "spotify",
      };
    }
  } catch (err) {
    console.error("[ApiBridge] Spotify command error:", err);
  }
  return null;
}
