import { useEffect, useMemo, useState } from 'react';
import type { JobInfo } from '@shared/domain/job';
import type { PdfPageInfo, PdfTextBlock } from '@shared/domain/pdf-extract';
import type { ImportResult } from '@shared/domain/import-result';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useImportStore } from '@/stores/import.store';
import { useJobStore } from '@/stores/job.store';
import { useNavStore } from '@/stores/nav.store';
import { useSelectionStore } from '@/stores/selection.store';

export function StandardReview() {
  const setView = useNavStore((s) => s.setView);
  const { selectedSourceId, selectedJobId, setSelectedJob } = useSelectionStore();
  const { jobs, ensureSubscribed } = useJobStore();
  const { recent } = useImportStore();

  const [pages, setPages] = useState<PdfPageInfo[] | null>(null);
  const [textBlocks, setTextBlocks] = useState<PdfTextBlock[] | null>(null);
  const [activePage, setActivePage] = useState(1);
  const [loadError, setLoadError] = useState<string | null>(null);

  const importItem = useMemo<ImportResult | null>(
    () => recent.find((r) => r.source.id === selectedSourceId) ?? null,
    [recent, selectedSourceId],
  );

  const job: JobInfo | null = useMemo(() => {
    if (selectedJobId && jobs[selectedJobId]) return jobs[selectedJobId];
    // Fall back to the most recent job for this source.
    const candidates = Object.values(jobs).filter((j) => j.sourceId === selectedSourceId);
    candidates.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return candidates[0] ?? null;
  }, [jobs, selectedJobId, selectedSourceId]);

  useEffect(() => {
    ensureSubscribed();
  }, [ensureSubscribed]);

  // Load artifacts after the job is reported successful.
  useEffect(() => {
    if (!selectedSourceId || !job || job.status !== 'succeeded') return;
    let cancelled = false;
    setLoadError(null);
    void (async () => {
      try {
        const [p, b] = await Promise.all([
          window.nb.artifact.readJson<PdfPageInfo[]>({
            scope: 'standards',
            ownerId: selectedSourceId,
            name: 'pages.json',
          }),
          window.nb.artifact.readJson<PdfTextBlock[]>({
            scope: 'standards',
            ownerId: selectedSourceId,
            name: 'text-blocks.json',
          }),
        ]);
        if (cancelled) return;
        setPages(p);
        setTextBlocks(b);
        setActivePage(p[0]?.page ?? 1);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSourceId, job?.status]);

  if (!selectedSourceId || !importItem) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">没有选中的标准 PDF。</p>
        <Button onClick={() => setView('standard-import')}>去导入页选择一份</Button>
      </div>
    );
  }

  const blocksForPage = textBlocks?.filter((b) => b.page === activePage) ?? [];

  return (
    <div className="flex h-full flex-col gap-4 p-6">
      <header className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => {
              setSelectedJob(null);
              setView('standard-import');
            }}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← 返回标准导入
          </button>
          <h1 className="mt-1 truncate text-xl font-semibold tracking-tight">
            {importItem.source.originalName}
          </h1>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {importItem.source.relativePath}
          </p>
        </div>
        <JobBadge job={job} />
      </header>

      {job && job.status !== 'succeeded' && (
        <ProgressBar progress={job.progress} message={job.message} />
      )}

      {loadError && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          {loadError}
        </div>
      )}

      {pages && (
        <div className="flex min-h-0 flex-1 gap-4">
          <aside className="flex w-32 flex-col gap-1 overflow-y-auto rounded-md border bg-card p-2">
            <p className="px-2 py-1 text-[10px] uppercase tracking-wide text-muted-foreground">
              {pages.length} 页
            </p>
            {pages.map((p) => (
              <button
                key={p.page}
                type="button"
                onClick={() => setActivePage(p.page)}
                className={cn(
                  'flex flex-col items-start gap-0.5 rounded px-2 py-1.5 text-left text-xs transition-colors',
                  p.page === activePage
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                <span className="font-medium">第 {p.page} 页</span>
                <span className="text-[10px] opacity-80">{p.textBlockCount} 块</span>
              </button>
            ))}
          </aside>

          <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-md border bg-card">
            <div className="border-b px-4 py-2 text-xs text-muted-foreground">
              第 {activePage} 页 · {blocksForPage.length} 个文本块（按读取顺序）
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {blocksForPage.length === 0 ? (
                <p className="text-xs text-muted-foreground">本页没有文本块。</p>
              ) : (
                <ol className="flex flex-col gap-2 text-sm">
                  {blocksForPage.map((b) => (
                    <li key={b.id} className="flex gap-3">
                      <span className="w-10 shrink-0 text-right font-mono text-[10px] text-muted-foreground">
                        {b.readingOrder + 1}
                      </span>
                      <span className="flex-1 whitespace-pre-wrap break-words">{b.text}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </main>
        </div>
      )}

      {!pages && job?.status === 'succeeded' && (
        <p className="text-xs text-muted-foreground">正在加载抽取结果…</p>
      )}
      {!pages && job && job.status !== 'succeeded' && job.status !== 'failed' && (
        <p className="text-xs text-muted-foreground">正在抽取页面文本，完成后将自动展示。</p>
      )}
      {job?.status === 'failed' && (
        <p className="text-xs text-destructive">抽取失败：{job.error ?? '未知错误'}</p>
      )}
    </div>
  );
}

function JobBadge({ job }: { job: JobInfo | null }) {
  if (!job) return null;
  const tone = {
    queued: 'bg-muted text-muted-foreground',
    running: 'bg-amber-500/10 text-amber-400',
    succeeded: 'bg-emerald-500/10 text-emerald-400',
    failed: 'bg-destructive/10 text-destructive',
    cancelled: 'bg-muted text-muted-foreground',
  }[job.status];

  return (
    <span className={cn('rounded px-2 py-0.5 text-[11px]', tone)}>
      {labelForStatus(job.status)}
    </span>
  );
}

function ProgressBar({ progress, message }: { progress: number; message?: string }) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span>{message ?? '处理中…'}</span>
        <span className="font-mono">{Math.round(progress * 100)}%</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-all duration-200"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
    </div>
  );
}

function labelForStatus(s: JobInfo['status']): string {
  switch (s) {
    case 'queued':
      return '排队中';
    case 'running':
      return '抽取中';
    case 'succeeded':
      return '已完成';
    case 'failed':
      return '失败';
    case 'cancelled':
      return '已取消';
  }
}
