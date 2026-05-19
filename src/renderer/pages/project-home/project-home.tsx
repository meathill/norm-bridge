import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProjectStore } from '@/stores/project.store';

export function ProjectHome() {
  const { status, loading, error, current, refresh, createProject, openProject, closeProject } =
    useProjectStore();

  const [mode, setMode] = useState<'idle' | 'create' | 'open'>('idle');
  const [directory, setDirectory] = useState('');
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handlePickDirectory() {
    const result = await window.nb.dialog.pickDirectory({
      title: mode === 'create' ? '选择新项目目录' : '选择已有项目目录',
    });
    if (!result.canceled && result.directory) {
      setDirectory(result.directory);
    }
  }

  async function handleSubmit() {
    setLocalError(null);
    if (!directory.trim()) {
      setLocalError('请先选择目录');
      return;
    }
    try {
      if (mode === 'create') {
        if (!name.trim()) {
          setLocalError('请输入项目名称');
          return;
        }
        await createProject({ directory: directory.trim(), name: name.trim() });
      } else {
        await openProject({ directory: directory.trim() });
      }
      setMode('idle');
      setDirectory('');
      setName('');
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }

  function startCreate() {
    setMode('create');
    setDirectory('');
    setName('');
    setLocalError(null);
  }

  function startOpen() {
    setMode('open');
    setDirectory('');
    setName('');
    setLocalError(null);
  }

  function cancel() {
    setMode('idle');
    setDirectory('');
    setName('');
    setLocalError(null);
  }

  if (current && status) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
        <header className="text-center">
          <h1 className="text-2xl font-semibold tracking-tight">NormBridge</h1>
          <p className="text-sm text-muted-foreground">本地优先的 AI 标准索引工作台</p>
        </header>

        <section className="w-full max-w-xl rounded-lg border bg-card p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-medium">{current.config.name}</h2>
              <p className="mt-1 truncate text-xs text-muted-foreground">{current.directory}</p>
              <p className="mt-3 text-xs text-muted-foreground">
                项目 ID{' '}
                <span className="font-mono text-foreground">{current.config.projectId}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                创建于 <span className="text-foreground">{current.config.createdAt}</span>
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => void closeProject()}>
              关闭项目
            </Button>
          </div>

          <dl className="mt-6 grid grid-cols-4 gap-3 text-center">
            {[
              { label: '标准 PDF', value: status.counts.standards },
              { label: '产品输入', value: status.counts.inputs },
              { label: '证据材料', value: status.counts.evidence },
              { label: '历史任务', value: status.counts.jobs },
            ].map((item) => (
              <div key={item.label} className="rounded-md border bg-background py-3">
                <div className="text-lg font-semibold tabular-nums">{item.value}</div>
                <div className="text-xs text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </dl>
        </section>

        {error ? (
          <p className="text-xs text-destructive">{error}</p>
        ) : (
          <p className="text-xs text-muted-foreground">下一步：导入目标国家标准 PDF（即将开放）</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 p-8">
      <header className="text-center">
        <h1 className="text-3xl font-semibold tracking-tight">NormBridge</h1>
        <p className="mt-1 text-sm text-muted-foreground">本地优先的 AI 标准索引工作台</p>
      </header>

      {mode === 'idle' && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-3">
            <Button onClick={startCreate}>新建项目</Button>
            <Button variant="secondary" onClick={startOpen}>
              打开项目
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            项目目录将包含 PDF、artifacts、SQLite 与报告，可随用户本地工具同步
          </p>
        </div>
      )}

      {mode !== 'idle' && (
        <form
          className="flex w-full max-w-md flex-col gap-3 rounded-lg border bg-card p-6 shadow-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void handleSubmit();
          }}
        >
          <h2 className="text-lg font-medium">{mode === 'create' ? '新建项目' : '打开项目'}</h2>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground" htmlFor="directory">
              项目目录
            </label>
            <div className="flex gap-2">
              <Input
                id="directory"
                value={directory}
                placeholder={mode === 'create' ? '选择空目录或新建目录' : '选择已有项目目录'}
                onChange={(e) => setDirectory(e.target.value)}
              />
              <Button variant="secondary" size="md" onClick={() => void handlePickDirectory()}>
                浏览…
              </Button>
            </div>
          </div>

          {mode === 'create' && (
            <div className="flex flex-col gap-1">
              <label className="text-xs text-muted-foreground" htmlFor="name">
                项目名称
              </label>
              <Input
                id="name"
                value={name}
                placeholder="例如：UAE Low Voltage Standards"
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}

          {(localError ?? error) && (
            <p className="text-xs text-destructive">{localError ?? error}</p>
          )}

          <div className="mt-2 flex justify-end gap-2">
            <Button variant="ghost" size="md" onClick={cancel}>
              取消
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? '处理中…' : mode === 'create' ? '创建' : '打开'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
