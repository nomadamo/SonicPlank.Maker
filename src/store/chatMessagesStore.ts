export type ChatMessage = {
  id: string;
  username: string;
  color: string;
  message: string;
  timestamp: number;
};

// Module-level store written by TwitchChatNode, read by the compositor in
// target-output-node during the rAF render loop. Messages are ephemeral —
// not persisted across sessions.
export const chatMessagesStore = new Map<string, ChatMessage[]>();
