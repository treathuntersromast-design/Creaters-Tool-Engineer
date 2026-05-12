import Database from 'better-sqlite3';
import { generateId } from '../../utils/ids';

export interface Document {
  id: string;
  projectId: string;
  type: string;
  filePath: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export class DocumentRepository {
  constructor(private readonly db: Database.Database) {}

  upsert(data: { projectId: string; type: string; filePath: string; content: string }): Document {
    const existing = this.findByProjectAndType(data.projectId, data.type);
    const now = new Date().toISOString();

    if (existing) {
      this.db.prepare(`
        UPDATE documents SET filePath = ?, content = ?, updatedAt = ? WHERE id = ?
      `).run(data.filePath, data.content, now, existing.id);
      return this.findById(existing.id)!;
    } else {
      const id = generateId();
      this.db.prepare(`
        INSERT INTO documents (id, projectId, type, filePath, content, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, data.projectId, data.type, data.filePath, data.content, now, now);
      return this.findById(id)!;
    }
  }

  findById(id: string): Document | undefined {
    return this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id) as Document | undefined;
  }

  findByProjectId(projectId: string): Document[] {
    return this.db.prepare('SELECT * FROM documents WHERE projectId = ? ORDER BY createdAt ASC').all(projectId) as Document[];
  }

  findByProjectAndType(projectId: string, type: string): Document | undefined {
    return this.db.prepare('SELECT * FROM documents WHERE projectId = ? AND type = ?').get(projectId, type) as Document | undefined;
  }
}
