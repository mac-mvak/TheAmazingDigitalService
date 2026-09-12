export type ChatRole = "user" | "assistant";

export type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  imageUrl?: string;
  pending?: boolean;
  error?: boolean;
};

export type AssistantReply = {
  text: string;
  imageUrl?: string;
};

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
