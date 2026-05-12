import Database from 'better-sqlite3';
import { generateId } from '../../utils/ids';

export interface WebhookEvent {
  id: string;
  lineWebhookEventId: string;
  lineMessageId: string | null;
  userId: string | null;
  eventType: string;
  isRedelivery: number;
  receivedAt: string;
  processedAt: string | null;
  status: string;
  error: string | null;
}

export class WebhookEventRepository {
  constructor(private readonly db: Database.Database) {}

  insertOrIgnore(data: {
    lineWebhookEventId: string;
    lineMessageId?: string | null;
    userId?: string | null;
    eventType: string;
    isRedelivery: boolean;
  }): { inserted: boolean; id: string } {
    const id = generateId();
    const now = new Date().toISOString();
    const result = this.db.prepare(`
      INSERT OR IGNORE INTO webhook_events
        (id, lineWebhookEventId, lineMessageId, userId, eventType, isRedelivery, receivedAt, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'RECEIVED')
    `).run(
      id,
      data.lineWebhookEventId,
      data.lineMessageId ?? null,
      data.userId ?? null,
      data.eventType,
      data.isRedelivery ? 1 : 0,
      now
    );

    if ((result.changes as number) === 0) {
      const existing = this.findByLineEventId(data.lineWebhookEventId);
      return { inserted: false, id: existing?.id ?? id };
    }
    return { inserted: true, id };
  }

  findById(id: string): WebhookEvent | undefined {
    return this.db.prepare('SELECT * FROM webhook_events WHERE id = ?').get(id) as WebhookEvent | undefined;
  }

  findByLineEventId(lineWebhookEventId: string): WebhookEvent | undefined {
    return this.db.prepare('SELECT * FROM webhook_events WHERE lineWebhookEventId = ?').get(lineWebhookEventId) as WebhookEvent | undefined;
  }

  markProcessed(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE webhook_events SET status = 'PROCESSED', processedAt = ? WHERE id = ?
    `).run(now, id);
  }

  markFailed(id: string, error: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE webhook_events SET status = 'FAILED', processedAt = ?, error = ? WHERE id = ?
    `).run(now, error, id);
  }
}
