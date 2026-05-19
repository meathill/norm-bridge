import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useProjectStore } from '@/stores/project.store';

export function ChatEmptyProject() {
  const { createProject, openProject, loading, error } = useProjectStore();
  const [mode, setMode] = useState<'idle' | 'create' | 'open'>('idle');
  const [directory, setDirectory] = useState('');
  const [name, setName] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  async function pickDir(title: string): Promise<string | null> {
    const result = await window.nb.dialog.pickDirectory({ title });
    return result.canceled ? null : result.directory;
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
      } else if (mode === 'open') {
        await openProject({ directory: directory.trim() });
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
      <div className="max-w-lg rounded-lg border bg-card p-6 shadow-sm">
        <p className="text-sm">
          👋 欢迎使用 NormBridge。先选择一个本地工作目录开始，所有标准 PDF、artifacts 与 SQLite
          都会保存在该目录下。
        </p>
        {mode === 'idle' && (
          <div className="mt-4 flex gap-3">
            <Button
              onClick={async () => {
                const dir = await pickDir('选择新项目目录');
                if (dir) {
                  setDirectory(dir);
                  setMode('create');
                }
              }}
            >
              新建工作目录
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                const dir = await pickDir('选择已有项目目录');
                if (dir) {
                  setDirectory(dir);
                  setMode('open');
                  await openProject({ directory: dir }).catch((err) => {
                    setMode('idle');
                    setLocalError(err instanceof Error ? err.message : String(err));
                  });
                }
              }}
            >
              打开已有目录
            </Button>
          </div>
        )}
        {mode === 'create' && (
          <form
            className="mt-4 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSubmit();
            }}
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="dir" className="text-xs text-muted-foreground">
                目录
              </label>
              <Input
                id="dir"
                value={directory}
                onChange={(e) => setDirectory(e.target.value)}
                placeholder="/path/to/project"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="name" className="text-xs text-muted-foreground">
                项目名称
              </label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：UAE Low Voltage Standards"
              />
            </div>
            {(localError ?? error) && (
              <p className="text-xs text-destructive">{localError ?? error}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setMode('idle')}>
                取消
              </Button>
              <Button type="submit" size="sm" disabled={loading}>
                {loading ? '创建中…' : '创建项目'}
              </Button>
            </div>
          </form>
        )}
        {mode === 'open' && (localError ?? error) && (
          <p className="mt-3 text-xs text-destructive">{localError ?? error}</p>
        )}
      </div>
    </div>
  );
}
