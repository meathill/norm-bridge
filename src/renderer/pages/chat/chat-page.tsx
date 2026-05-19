import { useEffect } from 'react';
import { useJobStore } from '@/stores/job.store';
import { useProjectStore } from '@/stores/project.store';
import { ChatHeader } from './chat-header';
import { ChatConversation } from './chat-conversation';
import { ChatInput } from './chat-input';
import { ChatEmptyProject } from './chat-empty-project';

export function ChatPage() {
  const current = useProjectStore((s) => s.current);
  const refreshProject = useProjectStore((s) => s.refresh);
  const ensureJobsSubscribed = useJobStore((s) => s.ensureSubscribed);

  useEffect(() => {
    void refreshProject();
    ensureJobsSubscribed();
  }, [refreshProject, ensureJobsSubscribed]);

  return (
    <div className="flex h-full flex-col bg-background text-foreground">
      <ChatHeader />
      {current ? (
        <>
          <ChatConversation />
          <ChatInput />
        </>
      ) : (
        <ChatEmptyProject />
      )}
    </div>
  );
}
