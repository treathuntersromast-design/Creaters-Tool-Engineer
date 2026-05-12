import { sanitizeLogObject } from '../../src/utils/logger';

describe('sanitizeLogObject', () => {
  describe('secret key masking', () => {
    it('masks channelAccessToken', () => {
      const result = sanitizeLogObject({ channelAccessToken: 'super-secret-token' }) as Record<string, unknown>;
      expect(result.channelAccessToken).toBe('[REDACTED]');
    });

    it('masks channelSecret', () => {
      const result = sanitizeLogObject({ channelSecret: 'my-channel-secret' }) as Record<string, unknown>;
      expect(result.channelSecret).toBe('[REDACTED]');
    });

    it('masks replyToken', () => {
      const result = sanitizeLogObject({ replyToken: 'reply-token-xyz' }) as Record<string, unknown>;
      expect(result.replyToken).toBe('[REDACTED]');
    });

    it('masks authorization', () => {
      const result = sanitizeLogObject({ authorization: 'Bearer abc123' }) as Record<string, unknown>;
      expect(result.authorization).toBe('[REDACTED]');
    });

    it('masks x-line-signature', () => {
      const result = sanitizeLogObject({ 'x-line-signature': 'sig=abc' }) as Record<string, unknown>;
      expect(result['x-line-signature']).toBe('[REDACTED]');
    });

    it('masks LINE_CHANNEL_ACCESS_TOKEN', () => {
      const result = sanitizeLogObject({ LINE_CHANNEL_ACCESS_TOKEN: 'tok' }) as Record<string, unknown>;
      expect(result.LINE_CHANNEL_ACCESS_TOKEN).toBe('[REDACTED]');
    });

    it('masks LINE_CHANNEL_SECRET', () => {
      const result = sanitizeLogObject({ LINE_CHANNEL_SECRET: 'sec' }) as Record<string, unknown>;
      expect(result.LINE_CHANNEL_SECRET).toBe('[REDACTED]');
    });
  });

  describe('userId partial masking', () => {
    it('shows only last 4 chars for userId longer than 4 chars', () => {
      const result = sanitizeLogObject({ userId: 'Uabcdefgh' }) as Record<string, unknown>;
      expect(result.userId).toBe('*****efgh');
    });

    it('leaves userId unchanged when exactly 4 chars', () => {
      const result = sanitizeLogObject({ userId: 'Uabc' }) as Record<string, unknown>;
      expect(result.userId).toBe('Uabc');
    });

    it('leaves userId unchanged when shorter than 4 chars', () => {
      const result = sanitizeLogObject({ userId: 'Uab' }) as Record<string, unknown>;
      expect(result.userId).toBe('Uab');
    });

    it('masks userId in nested objects', () => {
      const result = sanitizeLogObject({ user: { userId: 'U_longusername' } }) as any;
      expect(result.user.userId).toMatch(/\*+.{4}/);
    });
  });

  describe('nested object sanitization', () => {
    it('sanitizes secrets in nested objects', () => {
      const input = {
        request: {
          headers: {
            authorization: 'Bearer secret-token',
          },
        },
      };
      const result = sanitizeLogObject(input) as any;
      expect(result.request.headers.authorization).toBe('[REDACTED]');
    });

    it('sanitizes deeply nested secrets', () => {
      const input = { a: { b: { c: { channelSecret: 'top-secret' } } } };
      const result = sanitizeLogObject(input) as any;
      expect(result.a.b.c.channelSecret).toBe('[REDACTED]');
    });
  });

  describe('array sanitization', () => {
    it('sanitizes objects inside arrays', () => {
      const input = [{ channelAccessToken: 'tok1' }, { channelAccessToken: 'tok2' }];
      const result = sanitizeLogObject(input) as any[];
      expect(result[0].channelAccessToken).toBe('[REDACTED]');
      expect(result[1].channelAccessToken).toBe('[REDACTED]');
    });

    it('handles arrays of primitives without change', () => {
      const input = [1, 'hello', true];
      const result = sanitizeLogObject(input);
      expect(result).toEqual([1, 'hello', true]);
    });
  });

  describe('primitive passthrough', () => {
    it('returns null as-is', () => {
      expect(sanitizeLogObject(null)).toBeNull();
    });

    it('returns undefined as-is', () => {
      expect(sanitizeLogObject(undefined)).toBeUndefined();
    });

    it('returns string as-is', () => {
      expect(sanitizeLogObject('hello')).toBe('hello');
    });

    it('returns number as-is', () => {
      expect(sanitizeLogObject(42)).toBe(42);
    });

    it('returns boolean as-is', () => {
      expect(sanitizeLogObject(true)).toBe(true);
    });
  });

  describe('non-secret keys', () => {
    it('preserves unrelated keys unchanged', () => {
      const result = sanitizeLogObject({ projectId: 'abc', status: 'RUNNING', count: 5 }) as Record<string, unknown>;
      expect(result.projectId).toBe('abc');
      expect(result.status).toBe('RUNNING');
      expect(result.count).toBe(5);
    });

    it('masks secrets while preserving other keys', () => {
      const result = sanitizeLogObject({
        channelAccessToken: 'secret',
        phase: 'requirements',
        ok: true,
      }) as Record<string, unknown>;
      expect(result.channelAccessToken).toBe('[REDACTED]');
      expect(result.phase).toBe('requirements');
      expect(result.ok).toBe(true);
    });
  });
});
