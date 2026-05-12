import Database from 'better-sqlite3';
import { generateId } from '../../utils/ids';

export interface WorkflowRun {
  id: string;
  projectId: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export class WorkflowRunRepository {
  constructor(private readonly db: Database.Database) {}

  create(projectId: string): WorkflowRun {
    const id = generateId();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO workflow_runs (id, projectId, status, startedAt)
      VALUES (?, ?, 'RUNNING', ?)
    `).run(id, projectId, now);
    return this.findById(id)!;
  }

  findById(id: string): WorkflowRun | undefined {
    return this.db.prepare('SELECT * FROM workflow_runs WHERE id = ?').get(id) as WorkflowRun | undefined;
  }

  findByProjectId(projectId: string): WorkflowRun[] {
    return this.db.prepare('SELECT * FROM workflow_runs WHERE projectId = ? ORDER BY startedAt DESC').all(projectId) as WorkflowRun[];
  }

  hasRunning(projectId: string): boolean {
    const row = this.db.prepare(
      "SELECT id FROM workflow_runs WHERE projectId = ? AND status = 'RUNNING' LIMIT 1"
    ).get(projectId);
    return row !== undefined;
  }

  finish(id: string, status: 'SUCCEEDED' | 'FAILED' | 'CANCELLED', error?: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE workflow_runs SET status = ?, finishedAt = ?, error = ? WHERE id = ?
    `).run(status, now, error ?? null, id);
  }

  cancelRunning(projectId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE workflow_runs SET status = 'CANCELLED', finishedAt = ?
      WHERE projectId = ? AND status = 'RUNNING'
    `).run(now, projectId);
  }

  update(id: string, data: Partial<WorkflowRun>): void {
    const run = this.findById(id);
    if (!run) return;
    const updated = { ...run, ...data };
    this.db.prepare(`
      UPDATE workflow_runs SET status = ?, finishedAt = ?, error = ? WHERE id = ?
    `).run(updated.status, updated.finishedAt, updated.error, id);
  }
}
