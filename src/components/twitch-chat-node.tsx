import { BaseNodeCard } from "./base-node";
import { Handle, NodeProps, Position } from "@xyflow/react";
import { MessageSquare } from "lucide-react";
import { FlowNodeType } from "@/types/flow-node";
import { useSetAtom } from "jotai";
import { updateNodeDataAtom } from "@/store/flowStore";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import tmi from "tmi.js";
import { chatMessagesStore, type ChatMessage } from "@/store/chatMessagesStore";

const DEFAULTS = {
  x: 2,
  y: 50,
  width: 28,
  height: 38,
  opacity: 0.9,
  fontSize: 2.5,
  fontFamily: "Inter, sans-serif",
  fontWeight: "normal",
  fontStyle: "normal",
  maxMessages: 10,
  channel: "",
};

function fromNodeData(data: FlowNodeType["data"]) {
  return {
    x: data.x !== undefined ? Number(data.x) : DEFAULTS.x,
    y: data.y !== undefined ? Number(data.y) : DEFAULTS.y,
    width: data.width !== undefined ? Number(data.width) : DEFAULTS.width,
    height: data.height !== undefined ? Number(data.height) : DEFAULTS.height,
    opacity: data.opacity !== undefined ? Number(data.opacity) : DEFAULTS.opacity,
    fontSize: data.fontSize !== undefined ? Number(data.fontSize) : DEFAULTS.fontSize,
    fontFamily: (data.fontFamily as string) ?? DEFAULTS.fontFamily,
    fontWeight: (data.fontWeight as string) ?? DEFAULTS.fontWeight,
    fontStyle: (data.fontStyle as string) ?? DEFAULTS.fontStyle,
    maxMessages: data.maxMessages !== undefined ? Number(data.maxMessages) : DEFAULTS.maxMessages,
    channel: (data.channel as string) ?? DEFAULTS.channel,
  };
}

type ConnectionStatus = "idle" | "connecting" | "connected" | "error";

export function TwitchChatNode(NodeRef: NodeProps<FlowNodeType>) {
  const node = NodeRef;
  const updateNodeData = useSetAtom(updateNodeDataAtom);
  const clientRef = useRef<tmi.Client | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [messageCount, setMessageCount] = useState(0);

  useEffect(() => {
    if (node.data.x === undefined) {
      updateNodeData({ id: node.id, patch: DEFAULTS });
    }
  }, [node.id, node.data.x, updateNodeData]);

  const handleUpdate = useCallback(
    (patch: Partial<FlowNodeType["data"]>) => {
      updateNodeData({ id: node.id, patch });
    },
    [node.id, updateNodeData],
  );

  const [draft, setDraft] = useState(() => fromNodeData(node.data));
  const committed = useMemo(() => fromNodeData(node.data), [node.data]);

  useEffect(() => {
    setDraft(fromNodeData(node.data));
  }, [node.data]);

  const isDirty = (Object.keys(draft) as Array<keyof typeof draft>).some(
    (k) => draft[k] !== committed[k],
  );

  const set = useCallback(
    <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => {
      setDraft((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const handleApply = useCallback(() => {
    handleUpdate(draft);
  }, [draft, handleUpdate]);

  const connect = useCallback(
    (channel: string) => {
      const ch = channel.trim().replace(/^#/, "");
      if (!ch) return;

      setStatus("connecting");

      const client = new tmi.Client({ channels: [ch] });
      clientRef.current = client;

      client.connect().then(() => {
        setStatus("connected");
      }).catch(() => {
        setStatus("error");
        clientRef.current = null;
      });

      client.on("message", (_ch, tags, message) => {
        const newMsg: ChatMessage = {
          id: tags.id ?? crypto.randomUUID(),
          username: tags["display-name"] ?? tags.username ?? "anon",
          color: tags.color ?? "#9147ff",
          message,
          timestamp: Date.now(),
        };
        const max = committed.maxMessages;
        const existing = chatMessagesStore.get(node.id) ?? [];
        let next = [...existing, newMsg];
        if (next.length > max) next = next.slice(-max);
        chatMessagesStore.set(node.id, next);
        window.electron.sendChatMessages(node.id, next);
        setMessageCount((c) => c + 1);
      });

      client.on("disconnected", () => {
        setStatus("idle");
        clientRef.current = null;
      });
    },
    [committed.maxMessages, node.id],
  );

  const disconnect = useCallback(() => {
    clientRef.current?.disconnect().catch(() => {});
    clientRef.current = null;
    chatMessagesStore.delete(node.id);
    window.electron.sendChatMessages(node.id, []);
    setStatus("idle");
    setMessageCount(0);
  }, [node.id]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      clientRef.current?.disconnect().catch(() => {});
      chatMessagesStore.delete(node.id);
      window.electron.sendChatMessages(node.id, []);
    };
  }, [node.id]);

  const statusDot = {
    idle: "bg-secondary/60",
    connecting: "bg-yellow-500 animate-pulse",
    connected: "bg-green-500",
    error: "bg-red-500",
  }[status];

  const statusLabel = {
    idle: "Disconnected",
    connecting: "Connecting…",
    connected: `Connected · ${messageCount} msg${messageCount !== 1 ? "s" : ""}`,
    error: "Connection failed",
  }[status];

  const isActive = status === "connected" || status === "connecting";

  return (
    <>
      <BaseNodeCard
        id={node.id}
        selected={node.selected}
        isMinimized={!!node.data.isMinimized}
        borderColor="indigo"
        iconColor="indigo"
        icon={MessageSquare}
        title="Twitch Chat"
        subtitle="Live chat overlay"
        anchorName={`--twitchChatNode_${node.id}`}
      >
        <div className="flex flex-col gap-3 nodrag nopan nowheel">
          {/* Channel + connect */}
          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
              Channel
            </label>
            <div className="flex gap-1.5">
              <input
                type="text"
                value={draft.channel}
                onChange={(e) => set("channel", e.target.value)}
                placeholder="channelname"
                disabled={isActive}
                className="flex-1 min-w-0 bg-muted border border-border rounded px-2.5 py-1.5 text-xs text-foreground focus:border-indigo-500 focus:outline-none disabled:opacity-40"
              />
              {isActive ? (
                <button
                  onClick={disconnect}
                  className="px-2.5 py-1 bg-secondary/80 hover:bg-secondary/60 text-white text-[10px] font-semibold rounded cursor-pointer transition-colors shrink-0"
                >
                  Stop
                </button>
              ) : (
                <button
                  onClick={() => {
                    handleApply();
                    connect(draft.channel);
                  }}
                  disabled={!draft.channel.trim()}
                  className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-[10px] font-semibold rounded cursor-pointer transition-colors shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Connect
                </button>
              )}
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot}`} />
              <span className="text-[9px] text-muted-foreground">{statusLabel}</span>
            </div>
          </div>

          {/* Position & size */}
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                Position X (%)
              </label>
              <input
                type="number" min="0" max="100"
                value={draft.x}
                onChange={(e) => set("x", Number(e.target.value) || 0)}
                className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                Position Y (%)
              </label>
              <input
                type="number" min="0" max="100"
                value={draft.y}
                onChange={(e) => set("y", Number(e.target.value) || 0)}
                className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                Width (%)
              </label>
              <input
                type="number" min="1" max="100"
                value={draft.width}
                onChange={(e) => set("width", Number(e.target.value) || 1)}
                className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                Height (%)
              </label>
              <input
                type="number" min="1" max="100"
                value={draft.height}
                onChange={(e) => set("height", Number(e.target.value) || 1)}
                className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:border-indigo-500 focus:outline-none"
              />
            </div>
          </div>

          {/* Opacity */}
          <div className="flex flex-col gap-1">
            <div className="flex justify-between items-center">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                Opacity
              </label>
              <span className="text-[10px] text-muted-foreground">
                {Math.round(draft.opacity * 100)}%
              </span>
            </div>
            <input
              type="range" min="0" max="1" step="0.05"
              value={draft.opacity}
              onChange={(e) => set("opacity", Number(e.target.value))}
              className="w-full h-1 bg-secondary rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
            />
          </div>

          {/* Font & display settings */}
          <div className="grid grid-cols-2 gap-2 border-t border-border/40 pt-2.5">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                Font Size (%)
              </label>
              <input
                type="number" min="0.5" max="10" step="0.5"
                value={draft.fontSize}
                onChange={(e) => set("fontSize", Number(e.target.value) || 1)}
                className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:border-indigo-500 focus:outline-none"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                Max Messages
              </label>
              <select
                value={draft.maxMessages}
                onChange={(e) => set("maxMessages", Number(e.target.value))}
                className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:border-indigo-500 focus:outline-none cursor-pointer"
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={15}>15</option>
                <option value={20}>20</option>
              </select>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
              Font Family
            </label>
            <select
              value={draft.fontFamily}
              onChange={(e) => set("fontFamily", e.target.value)}
              className="w-full bg-muted border border-border rounded px-2.5 py-1.5 text-xs text-foreground focus:border-indigo-500 focus:outline-none cursor-pointer"
            >
              <option value="Inter, sans-serif">Inter</option>
              <option value="Roboto, sans-serif">Roboto</option>
              <option value="Outfit, sans-serif">Outfit</option>
              <option value='"Playfair Display", serif'>Playfair Display</option>
              <option value='"Fira Code", monospace'>Fira Code</option>
              <option value="Georgia, serif">Georgia</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                Weight
              </label>
              <select
                value={draft.fontWeight}
                onChange={(e) => set("fontWeight", e.target.value)}
                className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:border-indigo-500 focus:outline-none cursor-pointer"
              >
                <option value="300">Light</option>
                <option value="normal">Regular</option>
                <option value="500">Medium</option>
                <option value="600">Semi-Bold</option>
                <option value="bold">Bold</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider">
                Style
              </label>
              <select
                value={draft.fontStyle}
                onChange={(e) => set("fontStyle", e.target.value)}
                className="w-full bg-muted border border-border rounded px-2 py-1 text-xs text-foreground focus:border-indigo-500 focus:outline-none cursor-pointer"
              >
                <option value="normal">Normal</option>
                <option value="italic">Italic</option>
              </select>
            </div>
          </div>

          {isDirty && (
            <button
              onClick={handleApply}
              className="w-full py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded cursor-pointer transition-colors mt-1"
            >
              Apply
            </button>
          )}
        </div>
      </BaseNodeCard>

      <Handle
        id={`handle_${node.id}_source`}
        type="source"
        position={Position.Right}
        isConnectable={node.isConnectable}
        style={{ top: "34px" }}
        className="hover:!border-indigo-400 hover:!shadow-[0_0_10px_rgba(129,140,248,0.5)] hover:!scale-125"
      />
    </>
  );
}
