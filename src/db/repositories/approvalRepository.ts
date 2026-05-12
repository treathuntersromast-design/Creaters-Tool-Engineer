import Database from 'better-sqlite3';
import { generateId } from '../../utils/ids';

export interface Approval {
  id: string;
  projectId: string;
  type: string;
  status: string;
  comment: string | null;
  createdAt: string;
}

export class ApprovalRepository {
  constructor(private readonly db: Database.Database) {}

  create(data: { projectId: string; type: string; status?: string; comment?: string }): Approval {
    const id = generateId();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO approvals (id, projectId, type, status, comment, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, data.projectId, data.type, data.status ?? 'PENDING', data.comment ?? null, now);
    return this.findById(id)!;
  }

  findById(id: string): Approval | undefined {
    return this.db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) as Approval | undefined;
  }

  findByProjectId(projectId: string): Approval[] {
    return this.db.prepare('SELECT * FROM approvals WHERE projectId = ? ORDER BY createdAt DESC').all(projectId) as Approval[];
  }

  update(id: string, status: string, comment?: string): void {
    this.db.prepare('UPDATE approvals SET status = ?, comment = ? WHERE id = ?').run(status, comment ?? null, id);
  }
}
