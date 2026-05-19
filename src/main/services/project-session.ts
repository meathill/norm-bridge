import { newId } from '@shared/ids';
import type { ProjectInfo } from '@shared/domain/project';
import { ProjectFs, type CreateProjectInput } from './project-fs';
import { SqliteService } from './sqlite-service';

/**
 * Owns the currently-open project: its filesystem layout and its sqlite handle.
 * Only one project is active at a time in v0.1.
 */
export class ProjectSession {
  private current: ProjectInfo | null = null;

  constructor(
    private readonly fs: ProjectFs,
    private readonly sqlite: SqliteService,
  ) {}

  getCurrent(): ProjectInfo | null {
    return this.current;
  }

  getFs(): ProjectFs {
    return this.fs;
  }

  getSqlite(): SqliteService {
    return this.sqlite;
  }

  create(input: CreateProjectInput): ProjectInfo {
    this.closeIfOpen();
    const info = this.fs.createProject(input);
    this.openDb(info);
    this.recordAudit('project_created', info);
    this.current = info;
    return info;
  }

  open(directory: string): ProjectInfo {
    this.closeIfOpen();
    const info = this.fs.openProject(directory);
    this.openDb(info);
    this.recordAudit('project_opened', info);
    this.current = info;
    return info;
  }

  close(): boolean {
    const wasOpen = this.current !== null;
    this.closeIfOpen();
    return wasOpen;
  }

  private openDb(info: ProjectInfo): void {
    const dbPath = this.fs.resolveDbPath(info);
    this.sqlite.open(dbPath);
    this.sqlite.runMigrations();
  }

  private closeIfOpen(): void {
    if (this.sqlite.isOpen()) {
      this.sqlite.close();
    }
    this.current = null;
  }

  private recordAudit(eventType: string, info: ProjectInfo): void {
    this.sqlite
      .prepare(
        'INSERT INTO audit_events (id, event_type, actor, target_type, target_id, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        newId('auditEvent'),
        eventType,
        'system',
        'project',
        info.config.projectId,
        JSON.stringify({ directory: info.directory, name: info.config.name }),
        new Date().toISOString(),
      );
  }
}
