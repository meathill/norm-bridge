import { useEffect, useRef } from 'react';
import { useJobStore } from '@/stores/job.store';
import { useProjectStore } from '@/stores/project.store';
import { useRuntimeStore } from '@/stores/runtime.store';
import { nextChatId, useChatStore } from '@/stores/chat.store';
import { ChatHeader } from './chat-header';
import { ChatConversation } from './chat-conversation';
import { ChatInput } from './chat-input';
import { ChatEmptyProject } from './chat-empty-project';

export function ChatPage() {
  const current = useProjectStore((s) => s.current);
  const refreshProject = useProjectStore((s) => s.refresh);
  const ensureJobsSubscribed = useJobStore((s) => s.ensureSubscribed);
  const refreshRuntime = useRuntimeStore((s) => s.refresh);
  const announcedFor = useRef<string | null>(null);

  useEffect(() => {
    void refreshProject();
    ensureJobsSubscribed();
  }, [refreshProject, ensureJobsSubscribed]);

  // Each time a project opens (identified by directory), announce the runtime config once.
  useEffect(() => {
    if (!current) {
      announcedFor.current = null;
      return;
    }
    if (announcedFor.current === current.directory) return;
    announcedFor.current = current.directory;
    void (async () => {
      const status = await refreshRuntime();
      const chat = useChatStore.getState();
      chat.append({
        id: nextChatId('msg'),
        type: 'system',
        variant: 'info',
        createdAt: new Date().toISOString(),
        text: `✓ 已打开项目「${current.config.name}」于 ${current.directory}`,
      });
      if (!status) {
        chat.append({
          id: nextChatId('msg'),
          type: 'system',
          variant: 'error',
          createdAt: new Date().toISOString(),
          text: '无法读取 LLM 运行时配置（IPC 失败）。',
        });
        return;
      }
      if (status.ready) {
        chat.append({
          id: nextChatId('msg'),
          type: 'system',
          variant: 'info',
          createdAt: new Date().toISOString(),
          text:
            `🔌 LLM 已就绪：模型 ${status.compileModel} / ${status.searchModel}` +
            (status.baseURL ? ` · endpoint ${status.baseURL}` : ' · endpoint OpenAI 默认') +
            ` · API ${status.apiStyle === 'responses' ? 'Responses' : 'Chat Completions'}` +
            (status.apiKeyMasked ? ` · key ${status.apiKeyMasked}` : ''),
        });
      } else {
        chat.append({
          id: nextChatId('msg'),
          type: 'system',
          variant: 'error',
          createdAt: new Date().toISOString(),
          text:
            `❌ LLM 配置未就绪：${status.errorMessage ?? '未知原因'}\n` +
            `请在仓库根目录创建 .env（可参考 .env.example），填好 OPENAI_API_KEY` +
            ` 与可选的 OPENAI_BASE_URL / NORMBRIDGE_AGENT_MODEL，然后重启 app。`,
        });
      }

      // Already-compiled standards persist in SQLite — surface them so the user
      // knows they can search right away without re-running the compile.
      try {
        const compiled = await window.nb.standard.listCompiled();
        const usable = compiled.filter((c) => c.requirementCount > 0 || c.clauseCount > 0);
        if (usable.length > 0) {
          const lines = usable
            .slice(0, 10)
            .map(
              (c) =>
                `· ${c.title ?? c.standardId} — ${c.clauseCount} 条款 / ${c.requirementCount} requirement / ${c.referenceCount} 引用`,
            )
            .join('\n');
          chat.append({
            id: nextChatId('msg'),
            type: 'system',
            variant: 'success',
            createdAt: new Date().toISOString(),
            text: `📚 本项目已有 ${usable.length} 个已编译标准，可直接输入产品查询，无需重新分析：\n${lines}`,
          });
        }
      } catch {
        // non-fatal: listing is a convenience
      }
    })();
  }, [current, refreshRuntime]);

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
