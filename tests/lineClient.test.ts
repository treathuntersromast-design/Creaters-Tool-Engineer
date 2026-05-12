import { LineClient } from '../src/line/lineClient';

const TEST_TOKEN = 'test-channel-access-token';

describe('LineClient', () => {
  let fetchMock: jest.Mock;
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: async () => '{}',
    } as Response);
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('sendReply', () => {
    test('POSTs to /v2/bot/message/reply', async () => {
      const client = new LineClient(TEST_TOKEN);
      await client.sendReply('reply-token-123', 'Hello!');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.line.me/v2/bot/message/reply');
    });

    test('sends correct replyToken in body', async () => {
      const client = new LineClient(TEST_TOKEN);
      await client.sendReply('reply-token-123', 'Hello!');

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.replyToken).toBe('reply-token-123');
      expect(body.messages[0].text).toBe('Hello!');
    });

    test('includes Authorization Bearer header', async () => {
      const client = new LineClient(TEST_TOKEN);
      await client.sendReply('token', 'text');

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Bearer ${TEST_TOKEN}`);
    });

    test('does not include token in URL', async () => {
      const client = new LineClient(TEST_TOKEN);
      await client.sendReply('token', 'text');

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).not.toContain(TEST_TOKEN);
    });
  });

  describe('sendPush', () => {
    test('POSTs to /v2/bot/message/push', async () => {
      const client = new LineClient(TEST_TOKEN);
      await client.sendPush('U1234567890', 'Hello!');

      const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.line.me/v2/bot/message/push');
    });

    test('sends correct userId in body', async () => {
      const client = new LineClient(TEST_TOKEN);
      await client.sendPush('U1234567890', 'Hello!');

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(options.body as string);
      expect(body.to).toBe('U1234567890');
      expect(body.messages[0].text).toBe('Hello!');
    });

    test('includes Authorization Bearer header', async () => {
      const client = new LineClient(TEST_TOKEN);
      await client.sendPush('user', 'text');

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Record<string, string>;
      expect(headers['Authorization']).toBe(`Bearer ${TEST_TOKEN}`);
    });
  });

  describe('error handling', () => {
    test('throws when LINE API returns non-ok response', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: async () => '{"message":"Invalid reply token"}',
      } as Response);

      const client = new LineClient(TEST_TOKEN);
      await expect(client.sendReply('bad-token', 'text')).rejects.toThrow('LINE API error');
    });

    test('error message contains status code', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      } as Response);

      const client = new LineClient(TEST_TOKEN);
      await expect(client.sendReply('token', 'text')).rejects.toThrow('500');
    });
  });
});
