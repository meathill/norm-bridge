import { useEffect, useRef } from 'react';
import { useChatStore } from '@/stores/chat.store';
import { ChatMessageView } from './chat-message';

export function ChatConversation() {
  const messages = useChatStore((s) => s.messages);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to the latest message on append/update.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages.length, messages]);

  return (
    <main className="flex flex-1 flex-col overflow-y-auto px-4 py-6">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
        {messages.length === 0 && (
          <p className="text-center text-xs text-muted-foreground">
            把标准 PDF 拖到下方输入框开始。
          </p>
        )}
        {messages.map((m) => (
          <ChatMessageView key={m.id} message={m} />
        ))}
        <div ref={endRef} />
      </div>
    </main>
  );
}
