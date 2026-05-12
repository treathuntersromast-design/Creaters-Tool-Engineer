import Database from 'better-sqlite3';
import { generateId } from '../../utils/ids';

export type ProjectStatus =
  | 'CREATED'
  | 'HEARING'
  | 'REQUIREMENTS'
  | 'BASIC_DESIGN'
  | 'DETAILED_DESIGN'
  | 'IMPLEMENTATION'
  | 'TESTING'
  | 'REVIEW'
  | 'WAITING_APPROVAL'
  | 'REVISION_REQUESTED'
  | 'COMPLETED'
  | 'STOPPED'
  | 'FAILED';

export interface Project {
  id: string;
  name: string;
  slug: string;
  userId: string;
  status: ProjectStatus;
  isActive: number;
  previousStatus: string | null;
  lastError: string | null;
  revisionNumber: number;
  workspacePath: string;
  createdAt: string;
  updatedAt: string;
}

export class ProjectRepository {
  constructor(private readonly db: Database.Database) {}

  create(data: { name: string; slug: string; userId: string; workspacePath: string }): Project {
    const id = generateId();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO projects (id, name, slug, userId, status, isActive, previousStatus, lastError, revisionNumber, workspacePath, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, 'CREATED', 1, NULL, NULL, 0, ?, ?, ?)
    `).run(id, data.name, data.slug, data.userId, data.workspacePath, now, now);
    return this.findById(id)!;
  }

  findById(id: string): Project | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;
  }

  findActiveByUserId(userId: string): Project | undefined {
    return this.db.prepare(`
      SELECT * FROM projects
      WHERE userId = ? AND isActive = 1 AND status NOT IN ('COMPLETED', 'FAILED')
      ORDER BY createdAt DESC LIMIT 1
    `).get(userId) as Project | undefined;
  }

  findByUserId(userId: string): Project[] {
    return this.db.prepare('SELECT * FROM projects WHERE userId = ? ORDER BY createdAt DESC').all(userId) as Project[];
  }

  updateStatus(id: string, status: ProjectStatus, previousStatus?: string | null): void {
    const now = new Date().toISOString();
    if (previousStatus !== undefined) {
      this.db.prepare(`
        UPDATE projects SET status = ?, previousStatus = ?, updatedAt = ? WHERE id = ?
      `).run(status, previousStatus, now, id);
    } else {
      this.db.prepare(`
        UPDATE projects SET status = ?, updatedAt = ? WHERE id = ?
      `).run(status, now, id);
    }
  }

  setFailed(id: string, error: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE projects SET status = 'FAILED', isActive = 0, lastError = ?, updatedAt = ? WHERE id = ?
    `).run(error, now, id);
  }

  setCompleted(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE projects SET status = 'COMPLETED', isActive = 0, updatedAt = ? WHERE id = ?
    `).run(now, id);
  }

  setActive(id: string, isActive: boolean): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE projects SET isActive = ?, updatedAt = ? WHERE id = ?
    `).run(isActive ? 1 : 0, now, id);
  }

  incrementRevision(id: string): number {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE projects SET revisionNumber = revisionNumber + 1, updatedAt = ? WHERE id = ?
    `).run(now, id);
    return (this.findById(id)?.revisionNumber ?? 0);
  }

  clearPreviousStatus(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE projects SET previousStatus = NULL, updatedAt = ? WHERE id = ?
    `).run(now, id);
  }

  deactivateAllByUserId(userId: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE projects SET isActive = 0, status = 'STOPPED', updatedAt = ?
      WHERE userId = ? AND isActive = 1 AND status NOT IN ('COMPLETED', 'FAILED')
    `).run(now, userId);
  }
}
