import { splitIntoChunks } from '../../src/claude/claudeCodeService';

describe('splitIntoChunks', () => {
  it('returns single chunk when text fits', () => {
    const chunks = splitIntoChunks('hello', 100);
    expect(chunks).toEqual(['hello']);
  });

  it('splits text into correct number of chunks', () => {
    const text = 'a'.repeat(9000);
    const chunks = splitIntoChunks(text, 4000);
    expect(chunks.length).toBe(3);
    expect(chunks[0]!.length).toBe(4000);
    expect(chunks[1]!.length).toBe(4000);
    expect(chunks[2]!.length).toBe(1000);
  });

  it('returns "(応答なし)" for empty text', () => {
    const chunks = splitIntoChunks('', 4000);
    expect(chunks).toEqual(['(応答なし)']);
  });

  it('exact boundary — text length equals chunk size', () => {
    const text = 'x'.repeat(4000);
    const chunks = splitIntoChunks(text, 4000);
    expect(chunks.length).toBe(1);
    expect(chunks[0]!.length).toBe(4000);
  });

  it('preserves full text when reassembled', () => {
    const original = 'あいうえお'.repeat(1000);
    const chunks = splitIntoChunks(original, 100);
    expect(chunks.join('')).toBe(original);
  });
});

describe('ClaudeCodeService.runPlan', () => {
  it('sends ENOENT error message when claude is not installed', async () => {
    const pushMessages: Array<{ userId: string; text: string }> = [];
    const lineClient = {
      sendPush: jest.fn(async (userId: string, text: string) => {
        pushMessages.push({ userId, text });
      }),
    };

    // Reset modules so the re-require picks up the fresh mock
    jest.resetModules();
    jest.doMock('child_process', () => {
      const actual = jest.requireActual<typeof import('child_process')>('child_process');
      return {
        ...actual,
        execFile: (_cmd: string, _args: string[], _opts: unknown, cb: (err: unknown) => void) => {
          cb(Object.assign(new Error('not found'), { code: 'ENOENT' }));
        },
      };
    });

    const { ClaudeCodeService: CS } = await import('../../src/claude/claudeCodeService');
    const service = new CS(lineClient as any);

    await service.runPlan('/some/repo', 'プランを作成してください', 'U001');

    const texts = pushMessages.map((m) => m.text);
    expect(texts.some((t) => t.includes('インストール'))).toBe(true);

    jest.resetModules();
    jest.unmock('child_process');
  });
});
