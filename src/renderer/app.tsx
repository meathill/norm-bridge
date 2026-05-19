import { useEffect } from 'react';
import { ChatPage } from '@/pages/chat/chat-page';

export function App() {
  // Prevent the renderer from navigating away when a file is dropped outside the drop zone.
  useEffect(() => {
    const stop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('dragover', stop);
    document.addEventListener('drop', stop);
    return () => {
      document.removeEventListener('dragover', stop);
      document.removeEventListener('drop', stop);
    };
  }, []);

  return <ChatPage />;
}
