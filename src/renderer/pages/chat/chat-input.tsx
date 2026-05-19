import { useState, type DragEvent, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { importDroppedFiles, searchProduct } from './chat-actions';

export function ChatInput() {
  const [text, setText] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t || submitting) return;
    setText('');
    setSubmitting(true);
    try {
      await searchProduct(t);
    } finally {
      setSubmitting(false);
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDragLeave() {
    setDragOver(false);
  }

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const filePaths = files
      .map((f) => window.nb.files.getPathForFile(f))
      .filter((p): p is string => Boolean(p) && p.toLowerCase().endsWith('.pdf'));
    if (filePaths.length === 0) return;
    await importDroppedFiles(filePaths);
  }

  async function handlePickFiles() {
    const result = await window.nb.dialog.pickFiles({
      title: '选择标准 PDF',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (!result.canceled && result.filePaths.length > 0) {
      await importDroppedFiles(result.filePaths);
    }
  }

  return (
    <footer className="border-t bg-card/40 px-4 py-3">
      <div className="mx-auto w-full max-w-3xl">
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={(e) => void handleDrop(e)}
          className={cn(
            'rounded-xl border bg-background p-3 transition-colors',
            dragOver ? 'border-primary bg-primary/5' : 'border-border',
          )}
        >
          <form className="flex items-end gap-2" onSubmit={(e) => void handleSubmit(e)}>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="输入产品描述查询，或把 PDF 拖到这里"
              rows={2}
              className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  void handleSubmit(e as unknown as FormEvent);
                }
              }}
            />
            <div className="flex flex-col gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void handlePickFiles()}
              >
                📎
              </Button>
              <Button type="submit" size="sm" disabled={submitting || !text.trim()}>
                {submitting ? '…' : '发送'}
              </Button>
            </div>
          </form>
        </div>
        <p className="mt-2 text-center text-[10px] text-muted-foreground">
          拖入 PDF 直接导入并 inspection · 文本回车换行，⌘/Ctrl+Enter 发送
        </p>
      </div>
    </footer>
  );
}
