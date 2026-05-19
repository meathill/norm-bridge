import { useState, type DragEvent } from 'react';
import type { DocumentInspection } from '@shared/domain/inspection';
import type { ImportResult } from '@shared/domain/import-result';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useImportStore } from '@/stores/import.store';
import { useJobStore } from '@/stores/job.store';
import { useNavStore } from '@/stores/nav.store';
import { useProjectStore } from '@/stores/project.store';
import { useSelectionStore } from '@/stores/selection.store';

export function StandardImport() {
  const { current } = useProjectStore();
  const { recent, importing, error, importStandardPdf, clearError } = useImportStore();
  const setView = useNavStore((s) => s.setView);
  const startExtract = useJobStore((s) => s.startStandardExtract);
  const setSelectedSource = useSelectionStore((s) => s.setSelectedSource);
  const setSelectedJob = useSelectionStore((s) => s.setSelectedJob);

  const [dragOver, setDragOver] = useState(false);

  async function handleFiles(filePaths: string[]) {
    clearError();
    for (const filePath of filePaths) {
      try {
        await importStandardPdf(filePath);
      } catch {
        // useImportStore already captured the error; abort the batch so the user can react.
        return;
      }
    }
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    const files = Array.from(event.dataTransfer.files);
    const filePaths = files
      .map((file) => window.nb.files.getPathForFile(file))
      .filter((p): p is string => Boolean(p));
    await handleFiles(filePaths);
  }

  async function handleBrowse() {
    const result = await window.nb.dialog.pickFiles({
      title: '选择标准 PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      await handleFiles(result.filePaths);
    }
  }

  return (
    <div className="flex h-full flex-col gap-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <button
            type="button"
            onClick={() => setView('home')}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            ← 返回项目首页
          </button>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">导入标准 PDF</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            拖入或选择目标国家技术标准 PDF。系统将做加密、文本层、页数与 OCR 需求的初步检查。
          </p>
        </div>
        {current && (
          <p className="max-w-xs truncate text-right text-xs text-muted-foreground">
            项目 <span className="text-foreground">{current.config.name}</span>
          </p>
        )}
      </header>

      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(e) => void handleDrop(e)}
        className={cn(
          'flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition-colors',
          dragOver
            ? 'border-primary bg-primary/5 text-foreground'
            : 'border-border bg-card text-muted-foreground',
        )}
      >
        <p className="text-sm">把 PDF 文件拖到这里，或</p>
        <Button onClick={() => void handleBrowse()} disabled={importing}>
          {importing ? '处理中…' : '选择文件…'}
        </Button>
        <p className="text-xs">支持多文件批量导入；同一份 PDF（按 sha256）只会复制一次。</p>
      </div>

      {error && (
        <div className="rounded-md border border-destructive bg-destructive/10 p-3 text-xs text-destructive">
          {error}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          本次会话导入 {recent.length > 0 ? `${recent.length} 份` : '0 份'}
        </h2>
        {recent.length === 0 && (
          <p className="rounded-md border border-dashed bg-card/50 p-6 text-center text-xs text-muted-foreground">
            还没有导入。拖入第一份标准 PDF 开始。
          </p>
        )}
        <ul className="flex flex-col gap-3">
          {recent.map((item) => (
            <ImportCard
              key={item.source.id}
              item={item}
              onCompileIndex={async () => {
                clearError();
                try {
                  const jobId = await startExtract(item.source.id);
                  setSelectedSource(item.source.id);
                  setSelectedJob(jobId);
                  setView('standard-review');
                } catch (err) {
                  // Surface via the page's error banner.
                  useImportStore.setState({
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function ImportCard({
  item,
  onCompileIndex,
}: {
  item: ImportResult;
  onCompileIndex: () => Promise<void> | void;
}) {
  const { source, inspection, alreadyExisted } = item;
  const blocked = inspection.isEncrypted || inspection.needsOcr === true;
  return (
    <li className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{source.originalName}</p>
          <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {source.relativePath}
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            sha256 {source.sha256.slice(0, 12)}… · {formatBytes(source.sizeBytes)}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          {alreadyExisted && (
            <span className="rounded bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
              已存在 · 复用
            </span>
          )}
          <Button size="sm" disabled={blocked} onClick={() => void onCompileIndex()}>
            {blocked ? '需要先处理上面的限制' : '编译索引 →'}
          </Button>
        </div>
      </div>

      <InspectionBadges inspection={inspection} />

      {inspection.warnings.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 border-t border-border pt-3">
          {inspection.warnings.map((w, i) => (
            <li key={`${source.id}-w-${i}`} className="text-[11px] text-muted-foreground">
              · {w}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function InspectionBadges({ inspection }: { inspection: DocumentInspection }) {
  const badges: Array<{ label: string; tone: 'ok' | 'warn' | 'bad' | 'info' }> = [];

  if (inspection.isEncrypted) {
    badges.push({ label: '已加密', tone: 'bad' });
  } else {
    badges.push({ label: '未加密', tone: 'ok' });
  }

  if (inspection.pageCount !== undefined) {
    badges.push({ label: `${inspection.pageCount} 页`, tone: 'info' });
  }

  if (inspection.hasTextLayer === true) {
    badges.push({ label: '有文本层', tone: 'ok' });
  } else if (inspection.hasTextLayer === false) {
    badges.push({ label: '无文本层', tone: 'warn' });
  }

  if (inspection.needsOcr === true) {
    badges.push({ label: '需要 OCR', tone: 'warn' });
  }

  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {badges.map((b) => (
        <span
          key={b.label}
          className={cn(
            'rounded px-2 py-0.5 text-[11px]',
            b.tone === 'ok' && 'bg-emerald-500/10 text-emerald-400',
            b.tone === 'warn' && 'bg-amber-500/10 text-amber-400',
            b.tone === 'bad' && 'bg-destructive/10 text-destructive',
            b.tone === 'info' && 'bg-muted text-foreground',
          )}
        >
          {b.label}
        </span>
      ))}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
