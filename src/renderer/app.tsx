import { useEffect } from 'react';
import { ProjectHome } from '@/pages/project-home/project-home';
import { StandardImport } from '@/pages/standard-import/standard-import';
import { StandardReview } from '@/pages/standard-review/standard-review';
import { useJobStore } from '@/stores/job.store';
import { useNavStore } from '@/stores/nav.store';
import { useProjectStore } from '@/stores/project.store';

export function App() {
  const view = useNavStore((s) => s.view);
  const setView = useNavStore((s) => s.setView);
  const current = useProjectStore((s) => s.current);
  const ensureJobsSubscribed = useJobStore((s) => s.ensureSubscribed);

  // Subscribe to JobBus events for the lifetime of the renderer.
  useEffect(() => {
    ensureJobsSubscribed();
  }, [ensureJobsSubscribed]);

  // Any non-home view requires an open project. Bounce to home if the project is closed.
  useEffect(() => {
    if (!current && view !== 'home') {
      setView('home');
    }
  }, [current, view, setView]);

  // Prevent the renderer from navigating away when a file is dropped outside the drop zone.
  useEffect(() => {
    const stop = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };
    document.addEventListener('dragover', stop);
    document.addEventListener('drop', stop);
    return () => {
      document.removeEventListener('dragover', stop);
      document.removeEventListener('drop', stop);
    };
  }, []);

  return (
    <div className="h-full bg-background text-foreground">
      {view === 'home' && <ProjectHome />}
      {view === 'standard-import' && <StandardImport />}
      {view === 'standard-review' && <StandardReview />}
    </div>
  );
}
