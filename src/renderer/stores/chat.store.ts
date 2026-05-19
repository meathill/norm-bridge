import { create } from 'zustand';
import type { ChatMessage } from '@shared/domain/chat';

type ChatStoreState = {
  messages: ChatMessage[];
  append(message: ChatMessage): void;
  update(id: string, patch: Partial<ChatMessage>): void;
  removeById(id: string): void;
  reset(): void;
};

let chatIdCounter = 0;

export function nextChatId(prefix: string): string {
  chatIdCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${chatIdCounter}`;
}

export const useChatStore = create<ChatStoreState>((set) => ({
  messages: [],
  append(message) {
    set((state) => ({ messages: [...state.messages, message] }));
  },
  update(id, patch) {
    set((state) => ({
      messages: state.messages.map((m) => (m.id === id ? ({ ...m, ...patch } as ChatMessage) : m)),
    }));
  },
  removeById(id) {
    set((state) => ({ messages: state.messages.filter((m) => m.id !== id) }));
  },
  reset() {
    set({ messages: [] });
  },
}));
