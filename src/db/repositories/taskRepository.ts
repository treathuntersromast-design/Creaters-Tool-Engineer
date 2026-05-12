import Database from 'better-sqlite3';
import { generateId } from '../../utils/ids';

export interface Task {
  id: string;
  projectId: string;
  agentId: string | null;
  type: string;
  status: string;
  input: string | null;
  output: string | null;
  createdAt: string;
  updatedAt: string;
}

export class TaskRepository {
  constructor(private readonly db: Database.Database) {}

  create(data: {
    projectId: string;
    agentId: string | null;
    type: string;
    status: string;
    input?: string | null;
    output?: string | null;
  }): Task {
    const id = generateId();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO tasks (id, projectId, agentId, type, status, input, output, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.projectId, data.agentId ?? null, data.type, data.status, data.input ?? null, data.output ?? null, now, now);
    return this.findById(id)!;
  }

  findById(id: string): Task | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;
  }

  findByProjectId(projectId: string): Task[] {
    return this.db.prepare('SELECT * FROM tasks WHERE projectId = ? ORDER BY createdAt ASC').all(projectId) as Task[];
  }

  updateOutput(id: string, status: string, output: string): void {
    const now = new Date().toISOString();
    this.db.prepare('UPDATE tasks SET status = ?, output = ?, updatedAt = ? WHERE id = ?').run(status, output, now, id);
  }
}
