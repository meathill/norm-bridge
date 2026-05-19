import { Button } from '@/components/ui/button';
import { useChatStore } from '@/stores/chat.store';
import { useProjectStore } from '@/stores/project.store';

export function ChatHeader() {
  const current = useProjectStore((s) => s.current);
  const closeProject = useProjectStore((s) => s.closeProject);
  const resetChat = useChatStore((s) => s.reset);

  async function handleClose() {
    await closeProject();
    resetChat();
  }

  return (
    <header className="flex items-center justify-between border-b bg-card/40 px-4 py-3">
      <div className="flex min-w-0 items-baseline gap-3">
        <h1 className="text-base font-semibold tracking-tight">NormBridge</h1>
        {current ? (
          <p className="truncate text-xs text-muted-foreground">
            项目 <span className="text-foreground">{current.config.name}</span> ·{' '}
            <span className="font-mono">{current.directory}</span>
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">本地优先的 AI 标准索引工作台</p>
        )}
      </div>
      {current && (
        <Button variant="ghost" size="sm" onClick={() => void handleClose()}>
          关闭项目
        </Button>
      )}
    </header>
  );
}
