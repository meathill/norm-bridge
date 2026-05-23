import type {
  ChatInspectionMessage,
  ChatJobMessage,
  ChatSearchResultMessage,
} from '@shared/domain/chat';
import type { JobEvent } from '@shared/domain/job';
import { nextChatId, useChatStore } from '@/stores/chat.store';
import { useJobStore } from '@/stores/job.store';
import { useRuntimeStore } from '@/stores/runtime.store';

/** Re-check runtime config before any LLM-bound action. Returns true if it's safe to proceed. */
async function ensureRuntimeReady(label: string): Promise<boolean> {
  const status = await useRuntimeStore.getState().refresh();
  if (status && status.ready) return true;
  useChatStore.getState().append({
    id: nextChatId('msg'),
    type: 'system',
    variant: 'error',
    createdAt: new Date().toISOString(),
    text: `无法${label}：LLM 配置未就绪 — ${status?.errorMessage ?? '请检查 .env 中的 OPENAI_API_KEY'}`,
  });
  return false;
}

/**
 * Drop one or more PDF paths into the chat. Each file is imported (which
 * registers + inspects it) and a corresponding inspection bubble is appended.
 */
export async function importDroppedFiles(filePaths: string[]): Promise<void> {
  for (const filePath of filePaths) {
    const fileName = filePath.split(/[/\\]/).pop() ?? filePath;
    useChatStore.getState().append({
      id: nextChatId('msg'),
      type: 'user-file',
      createdAt: new Date().toISOString(),
      fileName,
      filePath,
    });

    try {
      const result = await window.nb.import.standardPdf({ filePath });
      // If this source was already compiled, don't push the user to recompile.
      const compiled = await window.nb.standard
        .listCompiled()
        .catch(() => [])
        .then((list) => list.find((c) => c.sourceId === result.source.id));
      const inspectionMsg: ChatInspectionMessage = {
        id: nextChatId('msg'),
        type: 'inspection',
        createdAt: new Date().toISOString(),
        source: result.source,
        inspection: result.inspection,
        awaitingStart: !compiled,
      };
      useChatStore.getState().append(inspectionMsg);
      if (compiled) {
        useChatStore.getState().append({
          id: nextChatId('msg'),
          type: 'system',
          variant: 'success',
          createdAt: new Date().toISOString(),
          text:
            `这份 PDF 已编译过（${compiled.clauseCount} 条款 / ${compiled.requirementCount} requirement），` +
            `直接输入产品查询即可，无需重新分析。`,
        });
      } else if (result.alreadyExisted) {
        useChatStore.getState().append({
          id: nextChatId('msg'),
          type: 'system',
          variant: 'info',
          createdAt: new Date().toISOString(),
          text: `这份 PDF 与项目里已有的 ${result.source.relativePath} 完全一致（sha256 匹配），已复用。`,
        });
      }
    } catch (err) {
      useChatStore.getState().append({
        id: nextChatId('msg'),
        type: 'system',
        variant: 'error',
        createdAt: new Date().toISOString(),
        text: `导入失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
}

/**
 * Kick off the extract → schema_compile pipeline for an already-imported
 * source. Mutates the inspection bubble so the "开始分析" button disappears
 * and creates two job bubbles that update in place as events flow in.
 */
export async function startAnalysisForSource(
  sourceId: string,
  inspectionMessageId: string,
): Promise<void> {
  if (!(await ensureRuntimeReady('启动分析'))) return;
  useChatStore
    .getState()
    .update(inspectionMessageId, { awaitingStart: false } as Partial<ChatInspectionMessage>);

  // Bubble that will track the extract job.
  const extractMsgId = nextChatId('msg');
  try {
    const extractJobId = await useJobStore.getState().startStandardExtract(sourceId);
    useChatStore.getState().append({
      id: extractMsgId,
      type: 'job',
      createdAt: new Date().toISOString(),
      jobId: extractJobId,
      kind: 'standard_extract',
      status: 'running',
      progress: 0,
      sourceId,
    });

    await waitForJob(extractJobId, (patch) => {
      useChatStore.getState().update(extractMsgId, patch);
    });

    // Compile.
    const compileMsgId = nextChatId('msg');
    const compileJobId = await useJobStore.getState().startSchemaCompile(sourceId);
    useChatStore.getState().append({
      id: compileMsgId,
      type: 'job',
      createdAt: new Date().toISOString(),
      jobId: compileJobId,
      kind: 'schema_compile',
      status: 'running',
      progress: 0,
      sourceId,
    });

    await waitForJob(compileJobId, (patch) => {
      useChatStore.getState().update(compileMsgId, patch);
    });

    // Read the bundle + section map for the final summary message.
    try {
      const bundle = await window.nb.artifact.readJson<{
        clauses: unknown[];
        requirements: unknown[];
        references: unknown[];
        citations: unknown[];
      }>({ scope: 'standards', ownerId: sourceId, name: 'standard-schema.v0.1.json' });
      const sections = await window.nb.artifact
        .readJson<{ source: string; entries: unknown[] }>({
          scope: 'standards',
          ownerId: sourceId,
          name: 'sections.json',
        })
        .catch(() => null);
      const sectionLine =
        sections && sections.entries.length > 0
          ? `目录共 ${sections.entries.length} 节（来源：${sections.source === 'printed_toc' ? '印刷目录' : sections.source}）。`
          : '未解析到章节目录，按整文档处理。';
      useChatStore.getState().append({
        id: nextChatId('msg'),
        type: 'system',
        variant: 'success',
        createdAt: new Date().toISOString(),
        text:
          `✅ 已编译标准索引。${sectionLine}\n` +
          `得到 ${bundle.clauses.length} 条款、${bundle.requirements.length} 个 requirement、` +
          `${bundle.references.length} 个引用标准、${bundle.citations.length} 条 citation。` +
          `\n现在可以在下方输入产品描述启动查询。`,
      });
    } catch {
      useChatStore.getState().append({
        id: nextChatId('msg'),
        type: 'system',
        variant: 'success',
        createdAt: new Date().toISOString(),
        text: '✅ 已编译标准索引。现在可以在下方输入产品描述启动查询。',
      });
    }
  } catch (err) {
    useChatStore.getState().append({
      id: nextChatId('msg'),
      type: 'system',
      variant: 'error',
      createdAt: new Date().toISOString(),
      text: `分析失败：${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

function waitForJob(jobId: string, patch: (p: Partial<ChatJobMessage>) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const off = window.nb.job.onEvent((event: JobEvent) => {
      if (event.jobId !== jobId) return;
      if (event.type === 'progress') {
        patch({ progress: event.progress, ...(event.message ? { message: event.message } : {}) });
      } else if (event.type === 'log') {
        // Verbose by design: surface every log line (info/warn/error) inline so the
        // user can see exactly what each LLM call is doing, how long it takes, and
        // what failed. This is a professional tool — detail beats hiding.
        const variant =
          event.level === 'error' ? 'error' : event.level === 'warn' ? 'warning' : 'info';
        useChatStore.getState().append({
          id: nextChatId('msg'),
          type: 'system',
          variant,
          dense: true,
          createdAt: new Date().toISOString(),
          text: `${new Date(event.at).toLocaleTimeString()} ${event.message}`,
        });
      } else if (event.type === 'finished') {
        off();
        if (event.status === 'succeeded') {
          patch({ status: 'succeeded', progress: 1 });
          resolve();
        } else {
          patch({ status: 'failed', error: event.error ?? '未知错误' });
          reject(new Error(event.error ?? `job ${jobId} ${event.status}`));
        }
      }
    });
  });
}

/**
 * Run a product query against the compiled schema. Falls through to a system
 * message when no standard has been compiled yet so the chat stays self-explanatory.
 */
export async function searchProduct(query: string): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) return;

  useChatStore.getState().append({
    id: nextChatId('msg'),
    type: 'user-text',
    createdAt: new Date().toISOString(),
    text: trimmed,
  });

  if (!(await ensureRuntimeReady('执行查询'))) return;

  try {
    const result = await window.nb.search.query({ text: trimmed });
    const msg: ChatSearchResultMessage = {
      id: nextChatId('msg'),
      type: 'search-result',
      createdAt: new Date().toISOString(),
      query: trimmed,
      cards: result.cards,
      ...(result.summary ? { summary: result.summary } : {}),
      ...(result.expanded ? { expanded: result.expanded } : {}),
    };
    useChatStore.getState().append(msg);
  } catch (err) {
    useChatStore.getState().append({
      id: nextChatId('msg'),
      type: 'system',
      variant: 'error',
      createdAt: new Date().toISOString(),
      text: `查询失败：${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
