const fs = require("fs");
const path = require("path");

const filePath = path.join("src", "components", "target-output-node.tsx");
let content = fs.readFileSync(filePath, "utf-8");

// 1. Replace rtmpUrl logic with node.data derivation
content = content.replace(
  /const rtmpUrl = useMemo\(\(\) => \{[\s\S]*?\}, \[settings\.streamUrl, settings\.streamToken\]\);/m,
  `const targetId = (node.data.streamTargetId as string) || (settings.rtmpTargets?.[0]?.id || "");
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
  }, [node.id, updateNodeData]);`
);

// 2. Add globalAudioNode extraction
content = content.replace(
  /\(an\) => an\.id === audioEdge\.source && an\.type === "audioFlowNode",/g,
  `(an) => an.id === audioEdge.source && (an.type === "audioFlowNode" || an.type === "globalAudioNode"),`
);

content = content.replace(
  /albumArt = \(audioNode\.data\.albumArt as string\) \|\| "";[\s\S]*?duration = Number\(audioNode\.data\.duration\) \|\| 0;/m,
  `if (audioNode.type === "audioFlowNode") {
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
            }`
);

// 3. Update startStreaming
content = content.replace(
  /const startStreaming = useCallback\(async \(\) => \{\n\s*if \(\!rtmpUrl \|\| \!captureSourceId\) return;/m,
  `const startStreaming = useCallback(async () => {
    const target = settings.rtmpTargets?.find((t) => t.id === targetId);
    if (!target || !target.url || !captureSourceId) return;

    const base = target.url.trim();
    const token = target.key.trim();
    const resolvedRtmpUrl = base.endsWith("/") ? \`\${base}\${token}\` : \`\${base}/\${token}\`;

    const isCustom = configType === "custom";
    const finalFps = isCustom ? customConfig.streamFps : settings.streamFps || 60;
    const finalEncoder = isCustom ? customConfig.streamEncoder : settings.streamEncoder || "copy";
    const finalDelay = isCustom ? customConfig.streamDelayMs : settings.streamDelayMs || 0;
    const finalBitrate = isCustom ? customConfig.streamBitrateKbps : settings.streamBitrateKbps || 6000;`
);

content = content.replace(
  /const streamFps = settings\.streamFps \?\? 60;/g,
  `const streamFps = finalFps;`
);

content = content.replace(
  /const bitrateKbps = settings\.streamBitrateKbps \|\| 6000;/g,
  `const bitrateKbps = finalBitrate;`
);

content = content.replace(
  /encoder: settings\.streamEncoder \|\| "libx264"/g,
  `encoder: finalEncoder`
);

content = content.replace(
  /streamDelayMs: settings\.streamDelayMs \?\? 0/g,
  `streamDelayMs: finalDelay`
);

content = content.replace(
  /window\.electron\.startStream\(rtmpUrl,/g,
  `window.electron.startStream(resolvedRtmpUrl,`
);

content = content.replace(
  /window\.electron\.startNativeStream\(\{[\s\S]*?rtmpUrl,[\s\S]*?fps: streamFps,/m,
  `window.electron.startNativeStream({
            rtmpUrl: resolvedRtmpUrl,
            fps: finalFps,`
);

content = content.replace(
  /streamFpsRef\.current = streamFps;/g,
  `streamFpsRef.current = finalFps;`
);

content = content.replace(
  /\} \], \[\n\s*rtmpUrl,\n/m,
  `} finally {
      setIsStarting(false);
    }
  }, [
    targetId,
    configType,
    customConfig,
    settings.rtmpTargets,
`
);

// 4. Update UI
const oldUI = `              {/* RTMP URL */}
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

              {/* FPS + Encoder */}
              <div className="flex gap-2 mt-1">
                <div className="flex flex-col gap-1 w-16 shrink-0">
                  <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                    FPS
                  </span>
                  <select
                    value={settings.streamFps ?? 60}
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
                      updateSettings({
                        streamEncoder: e.target.value as
                          | "copy"
                          | "libx264"
                          | "h264_nvenc"
                          | "h264_amf"
                          | "h264_qsv",
                      })
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
              </div>`;

const newUI = `              {/* Target Selection */}
              <div className="flex flex-col gap-1">
                <span className="text-[9px] font-semibold text-zinc-400 uppercase tracking-wider">
                  Target
                </span>
                {(!settings.rtmpTargets || settings.rtmpTargets.length === 0) ? (
                  <span className="text-xs text-amber-500 italic">No targets configured in settings.</span>
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
              )}`;

content = content.replace(oldUI, newUI);
content = content.replace(/"Start Stream"/g, '"Stream"');
content = content.replace(/> Start Stream/g, "> Stream");

fs.writeFileSync(filePath, content, "utf-8");
console.log("Updated");
