import type {
  ChatInspectionMessage,
  ChatJobMessage,
  ChatMessage,
  ChatSearchResultMessage,
  ChatSystemMessage,
  ChatUserFileMessage,
  ChatUserTextMessage,
} from '@shared/domain/chat';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { startAnalysisForSource } from './chat-actions';

export function ChatMessageView({ message }: { message: ChatMessage }) {
  switch (message.type) {
    case 'system':
      return <SystemBubble msg={message} />;
    case 'user-text':
      return <UserTextBubble msg={message} />;
    case 'user-file':
      return <UserFileBubble msg={message} />;
    case 'inspection':
      return <InspectionBubble msg={message} />;
    case 'job':
      return <JobBubble msg={message} />;
    case 'search-result':
      return <SearchResultBubble msg={message} />;
  }
}

function SystemBubble({ msg }: { msg: ChatSystemMessage }) {
  // Dense = operational log line: compact monospace row, not a chat bubble.
  if (msg.dense) {
    const logTone = {
      info: 'text-muted-foreground',
      success: 'text-emerald-400',
      warning: 'text-amber-400',
      error: 'text-destructive',
    }[msg.variant ?? 'info'];
    return (
      <div
        className={cn(
          'w-full self-stretch whitespace-pre-wrap break-words px-1 font-mono text-[11px] leading-relaxed',
          logTone,
        )}
      >
        {msg.text}
      </div>
    );
  }

  const tone = {
    info: 'border-border bg-card text-foreground',
    success: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-100',
    warning: 'border-amber-500/30 bg-amber-500/5 text-amber-100',
    error: 'border-destructive/30 bg-destructive/10 text-destructive',
  }[msg.variant ?? 'info'];
  return (
    <div className={cn('max-w-[80%] self-start rounded-2xl border px-4 py-2 text-sm', tone)}>
      {msg.text}
    </div>
  );
}

function UserTextBubble({ msg }: { msg: ChatUserTextMessage }) {
  return (
    <div className="max-w-[80%] self-end rounded-2xl bg-primary px-4 py-2 text-sm text-primary-foreground">
      {msg.text}
    </div>
  );
}

function UserFileBubble({ msg }: { msg: ChatUserFileMessage }) {
  return (
    <div className="max-w-[80%] self-end rounded-2xl bg-primary/80 px-4 py-2 text-sm text-primary-foreground">
      <div className="flex items-center gap-2">
        <span className="text-base">📄</span>
        <span className="font-medium">{msg.fileName}</span>
        {msg.sizeBytes ? (
          <span className="text-[11px] opacity-80">· {formatBytes(msg.sizeBytes)}</span>
        ) : null}
      </div>
    </div>
  );
}

function InspectionBubble({ msg }: { msg: ChatInspectionMessage }) {
  const { source, inspection } = msg;
  const isPdf = inspection.documentKind === 'pdf';
  return (
    <div className="max-w-[80%] self-start rounded-2xl border bg-card px-4 py-3 text-sm">
      <p className="font-medium">已识别 {isPdf ? 'PDF' : '文件'}</p>
      <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
        {source.relativePath}
      </p>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        <Badge tone={inspection.isEncrypted ? 'bad' : 'ok'}>
          {inspection.isEncrypted ? '已加密' : '未加密'}
        </Badge>
        {inspection.pageCount !== undefined && <Badge tone="info">{inspection.pageCount} 页</Badge>}
        {inspection.hasTextLayer === true && <Badge tone="ok">有文本层</Badge>}
        {inspection.hasTextLayer === false && <Badge tone="warn">无文本层</Badge>}
        {inspection.needsOcr === true && <Badge tone="warn">需要 OCR</Badge>}
      </ul>
      {inspection.warnings.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
          {inspection.warnings.map((w, i) => (
            <li key={i} className="text-[11px] text-muted-foreground">
              · {w}
            </li>
          ))}
        </ul>
      )}
      {msg.awaitingStart && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">点击「开始分析」抽取文本并编译索引。</p>
          <Button
            size="sm"
            disabled={inspection.isEncrypted || inspection.needsOcr === true}
            onClick={() => void startAnalysisForSource(source.id, msg.id)}
          >
            开始分析 →
          </Button>
        </div>
      )}
    </div>
  );
}

function JobBubble({ msg }: { msg: ChatJobMessage }) {
  const tone = {
    running: 'border-amber-500/30',
    succeeded: 'border-emerald-500/30',
    failed: 'border-destructive/40',
  }[msg.status];
  const title = msg.kind === 'standard_extract' ? '抽取 PDF' : '编译 Schema';
  return (
    <div
      className={cn('max-w-[80%] self-start rounded-2xl border bg-card px-4 py-3 text-sm', tone)}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-medium">{title}</span>
        <span
          className={cn(
            'rounded px-2 py-0.5 text-[10px]',
            msg.status === 'running' && 'bg-amber-500/15 text-amber-300',
            msg.status === 'succeeded' && 'bg-emerald-500/15 text-emerald-300',
            msg.status === 'failed' && 'bg-destructive/15 text-destructive',
          )}
        >
          {labelForStatus(msg.status)}
          {msg.status === 'running' ? ` · ${Math.round(msg.progress * 100)}%` : ''}
        </span>
      </div>
      {msg.status === 'running' && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full bg-primary transition-all duration-200"
            style={{ width: `${Math.round(msg.progress * 100)}%` }}
          />
        </div>
      )}
      {msg.message && <p className="mt-2 text-[11px] text-muted-foreground">{msg.message}</p>}
      {msg.error && <p className="mt-2 text-[11px] text-destructive">错误：{msg.error}</p>}
    </div>
  );
}

function SearchResultBubble({ msg }: { msg: ChatSearchResultMessage }) {
  return (
    <div className="max-w-[90%] self-start rounded-2xl border bg-card px-4 py-3 text-sm">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        查询：「{msg.query}」 · {msg.cards.length} 条相关
      </p>
      {msg.expanded?.tokens && msg.expanded.tokens.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {msg.expanded.tokens.map((t) => (
            <span
              key={t}
              className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      {msg.summary && <p className="mt-3 whitespace-pre-wrap text-sm">{msg.summary}</p>}
      {msg.cards.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">没有匹配的 requirement。</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {msg.cards.map((c) => {
            // 技术规范标准：所属 section / 标准；退回 clause。
            const standardLabel =
              c.standard?.sectionNo || c.standard?.sectionTitle
                ? `${c.standard.sectionNo ? `§${c.standard.sectionNo} ` : ''}${c.standard.sectionTitle ?? ''}`.trim()
                : c.clauseNo
                  ? `§${c.clauseNo} ${c.clauseTitle ?? ''}`.trim()
                  : (c.standard?.standardTitle ?? '标准');
            const citations = c.citations ?? [];
            return (
              <li key={c.cardId} className="rounded-md border border-border bg-background p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-foreground">{standardLabel}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm">{c.requirementText}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="shrink-0"
                    onClick={() => void window.nb.system.openSource({ sourceId: c.sourceId })}
                  >
                    打开 PDF
                  </Button>
                </div>

                {/* 引用地址：页码 + 原文摘录 */}
                {citations.length > 0 && (
                  <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
                    {citations.slice(0, 3).map((cit) => (
                      <div key={cit.citationId} className="text-[11px] text-muted-foreground">
                        <span className="mr-1 rounded bg-muted px-1.5 py-0.5 font-mono">
                          {cit.page !== undefined ? `p${cit.page}` : '—'}
                        </span>
                        <span className="italic">“{cit.quote.slice(0, 160)}”</span>
                      </div>
                    ))}
                  </div>
                )}

                {c.referencedStandards && c.referencedStandards.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1">
                    <span className="text-[10px] text-muted-foreground">引用标准：</span>
                    {c.referencedStandards.slice(0, 6).map((code) => (
                      <span
                        key={code}
                        className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground"
                      >
                        {code}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: 'ok' | 'warn' | 'bad' | 'info';
}) {
  return (
    <span
      className={cn(
        'rounded px-2 py-0.5 text-[10px]',
        tone === 'ok' && 'bg-emerald-500/10 text-emerald-400',
        tone === 'warn' && 'bg-amber-500/10 text-amber-400',
        tone === 'bad' && 'bg-destructive/10 text-destructive',
        tone === 'info' && 'bg-muted text-foreground',
      )}
    >
      {children}
    </span>
  );
}

function labelForStatus(s: ChatJobMessage['status']): string {
  switch (s) {
    case 'running':
      return '运行中';
    case 'succeeded':
      return '完成';
    case 'failed':
      return '失败';
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
