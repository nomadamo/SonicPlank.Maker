import { BaseNodeCard } from "./base-node";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { Radio as RadioIcon } from "lucide-react";
import { FlowNodeType } from "@/types/flow-node";
import { useSetAtom } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type AudioDevice = {
  id: string;
  name: string;
  kind: "output" | "microphone" | "capture";
  is_default: boolean;
};

const MIN_DB = -60;

function dbToFraction(db: number): number {
  if (!isFinite(db) || db <= MIN_DB) return 0;
  if (db >= 0) return 1;
  return (db - MIN_DB) / -MIN_DB;
}

function meterColor(db: number): string {
  if (db >= -6) return "#ef4444";
  if (db >= -18) return "#eab308";
  return "#22c55e";
}

export function AudioSourceNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const updateNodeData = useSetAtom(updateNodeDataAtom);
  const [devices, setDevices] = useState<AudioDevice[]>([]);
  const [peakDb, setPeakDb] = useState<number>(Number.NEGATIVE_INFINITY);

  // Web Audio preview state (capture / microphone devices)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const meterIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // IPC level state (output / loopback devices, active during streaming only)
  const ipcActiveRef = useRef(false);
  const ipcDecayRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    window.electron
      .getAudioDevices()
      .then((devs) => setDevices(devs as AudioDevice[]))
      .catch(console.error);
  }, []);

  // ── Web Audio preview for capture / microphone devices ─────────────────────
  // Chrome / Electron can access capture endpoints (VoiceMeeter Output, VB-CABLE,
  // microphones) via getUserMedia — no stream required.
  useEffect(() => {
    const deviceId = node.data.audioDeviceId as string | undefined;
    const deviceName = node.data.audioDeviceName as string | undefined;

    const stopPreview = () => {
      if (meterIntervalRef.current) {
        clearInterval(meterIntervalRef.current);
        meterIntervalRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };

    stopPreview();

    // Output / loopback devices cannot be captured via getUserMedia — handled by IPC.
    if (!deviceId || deviceId.startsWith("output:")) {
      setPeakDb(Number.NEGATIVE_INFINITY);
      return stopPreview;
    }

    let cancelled = false;

    (async () => {
      try {
        // Match our WASAPI friendly name to Chromium's enumerated device label.
        const chromeDevices = await navigator.mediaDevices.enumerateDevices();
        const matched = chromeDevices.find(
          (d) =>
            d.kind === "audioinput" &&
            !!deviceName &&
            d.label.toLowerCase().includes(deviceName.toLowerCase()),
        );

        if (cancelled) return;

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: matched
            ? { deviceId: { exact: matched.deviceId } }
            : { deviceId: { ideal: deviceId } },
          video: false,
        });

        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        const ctx = new AudioContext();
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = 0;
        source.connect(analyser);

        streamRef.current = stream;
        audioCtxRef.current = ctx;

        const buf = new Float32Array(analyser.fftSize);
        meterIntervalRef.current = setInterval(() => {
          analyser.getFloatTimeDomainData(buf);
          let peak = 0;
          for (let i = 0; i < buf.length; i++) {
            const a = Math.abs(buf[i]);
            if (a > peak) peak = a;
          }
          setPeakDb(peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY);
        }, 80);
      } catch (err) {
        if (!cancelled)
          console.warn("[AudioSourceNode] getUserMedia preview failed:", err);
      }
    })();

    return () => {
      cancelled = true;
      stopPreview();
    };
  }, [node.data.audioDeviceId, node.data.audioDeviceName]);

  // ── IPC AudioLevel fallback for output / loopback devices (during streaming) ─
  useEffect(() => {
    const deviceId = node.data.audioDeviceId as string | undefined;
    if (!deviceId?.startsWith("output:")) return;

    const cb = (db: number) => {
      ipcActiveRef.current = true;
      setPeakDb(db);
    };
    window.electron.onAudioLevel(cb);

    ipcDecayRef.current = setInterval(() => {
      if (!ipcActiveRef.current) setPeakDb(Number.NEGATIVE_INFINITY);
      ipcActiveRef.current = false;
    }, 500);

    return () => {
      window.electron.removeOnAudioLevel();
      if (ipcDecayRef.current) clearInterval(ipcDecayRef.current);
    };
  }, [node.data.audioDeviceId]);

  const handleDeviceChange = useCallback(
    (val: string) => {
      const dev = devices.find((d) => d.id === val);
      updateNodeData({
        id: node.id,
        patch: { audioDeviceId: val, audioDeviceName: dev?.name ?? val },
      });
    },
    [devices, node.id, updateNodeData],
  );

  const outputDevices = devices.filter((d) => d.kind === "output");
  const captureDevices = devices.filter((d) => d.kind === "capture");
  const micDevices = devices.filter((d) => d.kind === "microphone");

  const fill = dbToFraction(peakDb);
  const isActive = fill > 0;
  const isLoopback = !!(node.data.audioDeviceId as string | undefined)?.startsWith("output:");

  return (
    <>
      <BaseNodeCard
        id={node.id}
        selected={node.selected}
        isMinimized={!!node.data.isMinimized}
        borderColor="purple"
        iconColor="purple"
        icon={RadioIcon}
        title="Audio Source"
        subtitle="Stream audio capture"
        anchorName={`--audioSourceNode_${node.id}`}
      >
        {/* Device picker */}
        <div className="flex flex-col gap-1.5 nodrag nopan nowheel">
          <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            Audio Device
          </label>
          <Select
            value={(node.data.audioDeviceId as string) || ""}
            onValueChange={(val) => {
              if (typeof val === "string") handleDeviceChange(val);
            }}
          >
            <SelectTrigger className="w-full h-9 bg-muted border border-border rounded-lg flex items-center justify-between px-3 text-sm focus:border-purple-500 focus:ring-1 focus:ring-purple-500 text-foreground">
              <SelectValue placeholder="Select audio device">
                {(node.data.audioDeviceName as string) ||
                  (node.data.audioDeviceId as string) ||
                  "Select audio device"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-background border border-border rounded-lg p-1 max-h-64 overflow-y-auto shadow-xl">
              {captureDevices.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 pb-0.5">
                    Capture Devices
                  </SelectLabel>
                  {captureDevices.map((d) => (
                    <SelectItem
                      key={d.id}
                      value={d.id}
                      className="text-sm text-foreground/80"
                    >
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {micDevices.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 pb-0.5">
                    Microphones
                  </SelectLabel>
                  {micDevices.map((d) => (
                    <SelectItem
                      key={d.id}
                      value={d.id}
                      className="text-sm text-foreground/80"
                    >
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {outputDevices.length > 0 && (
                <SelectGroup>
                  <SelectLabel className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-2 pb-0.5">
                    System Audio (Loopback)
                  </SelectLabel>
                  {outputDevices.map((d) => (
                    <SelectItem
                      key={d.id}
                      value={d.id}
                      className="text-sm text-foreground/80"
                    >
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )}
              {devices.length === 0 && (
                <div className="text-xs text-muted-foreground p-3 text-center">
                  No audio devices found
                </div>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Level meter */}
        <div className="flex flex-col gap-1.5 nodrag nopan nowheel">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
              Level
            </label>
            <span
              className={`text-[10px] font-mono tabular-nums ${
                isActive ? "text-foreground" : "text-muted-foreground/50"
              }`}
            >
              {isActive ? `${peakDb.toFixed(1)} dBFS` : "—"}
            </span>
          </div>
          <div className="h-2 w-full bg-muted rounded-full overflow-hidden border border-border/40">
            <div
              className="h-full rounded-full transition-[width] duration-75"
              style={{
                width: `${fill * 100}%`,
                backgroundColor: isActive ? meterColor(peakDb) : "transparent",
              }}
            />
          </div>
          {!isActive && isLoopback && node.data.audioDeviceId && (
            <p className="text-[10px] text-muted-foreground/50 text-center">
              Loopback — meter active during stream
            </p>
          )}
        </div>
      </BaseNodeCard>

      <Handle
        id={`handle_${node.id}_source`}
        type="source"
        position={Position.Right}
        isConnectable={node.isConnectable}
        className="hover:!border-purple-400 hover:!shadow-[0_0_10px_rgba(168,85,247,0.5)] hover:!scale-125"
      />
    </>
  );
}
