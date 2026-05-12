import { createTestDb } from '../helpers/testDb';

const BASE_EVENT = {
  lineWebhookEventId: 'evt-001',
  lineMessageId:      'msg-001',
  userId:             'U_user',
  eventType:          'message',
  isRedelivery:       false,
};

describe('WebhookEventRepository', () => {
  describe('insertOrIgnore – happy path', () => {
    it('inserts a new event and returns inserted:true', () => {
      const { webhookEventRepo } = createTestDb();
      const result = webhookEventRepo.insertOrIgnore(BASE_EVENT);
      expect(result.inserted).toBe(true);
      expect(result.id).toBeTruthy();
    });

    it('stored record has status RECEIVED', () => {
      const { webhookEventRepo } = createTestDb();
      const { id } = webhookEventRepo.insertOrIgnore(BASE_EVENT);
      const stored = webhookEventRepo.findById(id)!;
      expect(stored.status).toBe('RECEIVED');
      expect(stored.processedAt).toBeNull();
    });

    it('stores isRedelivery flag', () => {
      const { webhookEventRepo } = createTestDb();
      const { id } = webhookEventRepo.insertOrIgnore({ ...BASE_EVENT, isRedelivery: true });
      expect(webhookEventRepo.findById(id)?.isRedelivery).toBe(1);
    });
  });

  describe('insertOrIgnore – deduplication (edge case)', () => {
    it('returns inserted:false for duplicate lineWebhookEventId', () => {
      const { webhookEventRepo } = createTestDb();
      webhookEventRepo.insertOrIgnore(BASE_EVENT);
      const result = webhookEventRepo.insertOrIgnore({ ...BASE_EVENT, lineMessageId: 'different-msg' });
      expect(result.inserted).toBe(false);
    });

    it('does NOT throw for duplicate event', () => {
      const { webhookEventRepo } = createTestDb();
      webhookEventRepo.insertOrIgnore(BASE_EVENT);
      expect(() => webhookEventRepo.insertOrIgnore(BASE_EVENT)).not.toThrow();
    });

    it('second insert returns the existing id', () => {
      const { webhookEventRepo } = createTestDb();
      const first = webhookEventRepo.insertOrIgnore(BASE_EVENT);
      const second = webhookEventRepo.insertOrIgnore(BASE_EVENT);
      expect(second.id).toBe(first.id);
    });

    it('allows different lineWebhookEventIds', () => {
      const { webhookEventRepo } = createTestDb();
      const r1 = webhookEventRepo.insertOrIgnore({ ...BASE_EVENT, lineWebhookEventId: 'evt-A' });
      const r2 = webhookEventRepo.insertOrIgnore({ ...BASE_EVENT, lineWebhookEventId: 'evt-B' });
      expect(r1.inserted).toBe(true);
      expect(r2.inserted).toBe(true);
      expect(r1.id).not.toBe(r2.id);
    });
  });

  describe('markProcessed', () => {
    it('updates status to PROCESSED and sets processedAt', () => {
      const { webhookEventRepo } = createTestDb();
      const { id } = webhookEventRepo.insertOrIgnore(BASE_EVENT);
      webhookEventRepo.markProcessed(id);
      const stored = webhookEventRepo.findById(id)!;
      expect(stored.status).toBe('PROCESSED');
      expect(stored.processedAt).toBeTruthy();
    });
  });

  describe('markFailed', () => {
    it('updates status to FAILED and stores error', () => {
      const { webhookEventRepo } = createTestDb();
      const { id } = webhookEventRepo.insertOrIgnore(BASE_EVENT);
      webhookEventRepo.markFailed(id, 'something went wrong');
      const stored = webhookEventRepo.findById(id)!;
      expect(stored.status).toBe('FAILED');
      expect(stored.error).toBe('something went wrong');
      expect(stored.processedAt).toBeTruthy();
    });
  });

  describe('findByLineEventId', () => {
    it('returns the event by lineWebhookEventId', () => {
      const { webhookEventRepo } = createTestDb();
      webhookEventRepo.insertOrIgnore(BASE_EVENT);
      const found = webhookEventRepo.findByLineEventId('evt-001');
      expect(found).toBeDefined();
      expect(found?.lineWebhookEventId).toBe('evt-001');
    });

    it('returns undefined for unknown event id', () => {
      const { webhookEventRepo } = createTestDb();
      expect(webhookEventRepo.findByLineEventId('non-existent')).toBeUndefined();
    });
  });

  describe('null handling', () => {
    it('allows null lineMessageId', () => {
      const { webhookEventRepo } = createTestDb();
      const { id, inserted } = webhookEventRepo.insertOrIgnore({
        lineWebhookEventId: 'evt-no-msg',
        lineMessageId: null,
        userId: 'U',
        eventType: 'follow',
        isRedelivery: false,
      });
      expect(inserted).toBe(true);
      expect(webhookEventRepo.findById(id)?.lineMessageId).toBeNull();
    });

    it('allows multiple NULL lineMessageIds (SQLite NULL uniqueness)', () => {
      // NULL != NULL in SQLite unique index, so multiple NULLs are allowed
      const { webhookEventRepo } = createTestDb();
      const r1 = webhookEventRepo.insertOrIgnore({ ...BASE_EVENT, lineWebhookEventId: 'e1', lineMessageId: null });
      const r2 = webhookEventRepo.insertOrIgnore({ ...BASE_EVENT, lineWebhookEventId: 'e2', lineMessageId: null });
      expect(r1.inserted).toBe(true);
      expect(r2.inserted).toBe(true);
    });
  });
});
