import Database from 'better-sqlite3';
import { generateId } from '../../utils/ids';

export interface Message {
  id: string;
  projectId: string | null;
  userId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  lineMessageId: string | null;
  createdAt: string;
}

export class MessageRepository {
  constructor(private readonly db: Database.Database) {}

  create(data: {
    projectId: string | null;
    userId: string;
    direction: 'INBOUND' | 'OUTBOUND';
    content: string;
    lineMessageId?: string | null;
  }): Message {
    const id = generateId();
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO messages (id, projectId, userId, direction, content, lineMessageId, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, data.projectId ?? null, data.userId, data.direction, data.content, data.lineMessageId ?? null, now);
    return this.findById(id)!;
  }

  findById(id: string): Message | undefined {
    return this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) as Message | undefined;
  }

  findByProjectId(projectId: string): Message[] {
    return this.db.prepare(
      'SELECT * FROM messages WHERE projectId = ? ORDER BY createdAt ASC'
    ).all(projectId) as Message[];
  }

  findByLineMessageId(lineMessageId: string): Message | undefined {
    return this.db.prepare(
      'SELECT * FROM messages WHERE lineMessageId = ?'
    ).get(lineMessageId) as Message | undefined;
  }

  listDistinctUsers(): Array<{ userId: string; lastMessage: string; messageCount: number }> {
    return this.db.prepare(`
      SELECT userId,
             MAX(createdAt) as lastMessage,
             COUNT(*) as messageCount
      FROM messages
      WHERE direction = 'INBOUND'
      GROUP BY userId
      ORDER BY lastMessage DESC
    `).all() as Array<{ userId: string; lastMessage: string; messageCount: number }>;
  }
}
