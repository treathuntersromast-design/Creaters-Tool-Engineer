import Database from 'better-sqlite3';
import { generateId } from '../../utils/ids';

export interface Agent {
  id: string;
  projectId: string;
  name: string;
  role: string;
  status: string;
  createdAt: string;
}

export class AgentRepository {
  constructor(private readonly db: Database.Database) {}

  create(data: { projectId: string; name: string; role: string }): Agent {
    const id = generateId();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO agents (id, projectId, name, role, status, createdAt)
      VALUES (?, ?, ?, ?, 'PENDING', ?)
    `).run(id, data.projectId, data.name, data.role, now);
    return this.findById(id)!;
  }

  findById(id: string): Agent | undefined {
    return this.db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Agent | undefined;
  }

  findByProjectId(projectId: string): Agent[] {
    return this.db.prepare('SELECT * FROM agents WHERE projectId = ? ORDER BY createdAt ASC').all(projectId) as Agent[];
  }

  findByRole(projectId: string, role: string): Agent | undefined {
    return this.db.prepare('SELECT * FROM agents WHERE projectId = ? AND role = ?').get(projectId, role) as Agent | undefined;
  }

  updateStatus(id: string, status: string): void {
    this.db.prepare('UPDATE agents SET status = ? WHERE id = ?').run(status, id);
  }
}
