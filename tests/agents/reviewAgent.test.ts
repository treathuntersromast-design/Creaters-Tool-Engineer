import { ReviewAgent } from '../../src/agents/ReviewAgent';
import { AgentContext, AgentResult } from '../../src/agents/Agent';
import { makeProject, makeHearingAnswers, createTestDb } from '../helpers/testDb';

// Access extractScore via a thin wrapper that calls run() and checks the score
// We test it indirectly through run() with a mock AI client, and directly through
// reviewing the output format.

const MOCK_CONTEXT_BASE = (): AgentContext => {
  const repos = createTestDb();
  const project = makeProject(repos);
  const task = { id: 't1', projectId: project.id, agentId: null, type: 'review',
    status: 'PENDING', input: null, output: null, createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString() } as any;
  return { project, task };
};

// ─── extractScore (via AI mock) ───────────────────────────────────────────

describe('ReviewAgent — extractScore (via AI mock)', () => {
  function makeMockClient(responseText: string) {
    return { generate: jest.fn().mockResolvedValue(responseText) };
  }

  async function runWithResponse(text: string): Promise<AgentResult> {
    const agent = new ReviewAgent(makeMockClient(text) as any);
    return agent.run({ ...MOCK_CONTEXT_BASE(), previousResults: [] });
  }

  it('extracts a plain integer score', async () => {
    const result = await runWithResponse('...review text...\nSCORE: 85\nRETRY_NEEDED: false');
    expect(result.score).toBe(85);
  });

  it('extracts score=0 (boundary low)', async () => {
    const result = await runWithResponse('SCORE: 0');
    expect(result.score).toBe(0);
  });

  it('extracts score=100 (boundary high)', async () => {
    const result = await runWithResponse('SCORE: 100');
    expect(result.score).toBe(100);
  });

  it('clamps score above 100 to 100', async () => {
    const result = await runWithResponse('SCORE: 150');
    expect(result.score).toBe(100);
  });

  it('returns undefined for negative score string (regex only matches digits)', async () => {
    // SCORE: -10 does not match /\d+/ so score is undefined — not clamped
    const result = await runWithResponse('SCORE: -10');
    expect(result.score).toBeUndefined();
  });

  it('returns undefined when SCORE line is absent', async () => {
    const result = await runWithResponse('レビュー完了しました。\nRETRY_NEEDED: false');
    expect(result.score).toBeUndefined();
    expect(result.ok).toBe(true);
  });

  it('is case-insensitive for SCORE keyword', async () => {
    const result = await runWithResponse('score: 72');
    expect(result.score).toBe(72);
  });

  it('ignores extra whitespace around score value', async () => {
    const result = await runWithResponse('SCORE:   91  ');
    expect(result.score).toBe(91);
  });

  it('returns undefined for non-numeric score', async () => {
    const result = await runWithResponse('SCORE: abc');
    expect(result.score).toBeUndefined();
  });

  it('stores review content in files and data', async () => {
    const text = 'good review\nSCORE: 78';
    const result = await runWithResponse(text);
    expect(result.ok).toBe(true);
    expect(result.files).toBeDefined();
    expect(result.files?.[0].path).toBe('logs/review-report.md');
    expect(result.files?.[0].content).toContain('SCORE: 78');
    expect((result.data as any).score).toBe(78);
  });

  it('returns ok=false on AI client error', async () => {
    const failClient = { generate: jest.fn().mockRejectedValue(new Error('API timeout')) };
    const agent = new ReviewAgent(failClient as any);
    const result = await agent.run({ ...MOCK_CONTEXT_BASE(), previousResults: [] });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('API timeout');
  });

  it('includes retryCount note in userPrompt on retry', async () => {
    const spy = jest.fn().mockResolvedValue('SCORE: 88');
    const agent = new ReviewAgent({ generate: spy } as any);
    await agent.run({ ...MOCK_CONTEXT_BASE(), retryCount: 2, previousResults: [] });
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).toContain('再試行 #2');
  });

  it('injects revisionContent when provided', async () => {
    const spy = jest.fn().mockResolvedValue('SCORE: 90');
    const agent = new ReviewAgent({ generate: spy } as any);
    await agent.run({ ...MOCK_CONTEXT_BASE(), revisionContent: 'ログイン機能を追加', previousResults: [] });
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).toContain('ログイン機能を追加');
  });

  it('injects lessonsLearned when provided', async () => {
    const spy = jest.fn().mockResolvedValue('SCORE: 90');
    const agent = new ReviewAgent({ generate: spy } as any);
    const lessons = [{ id: 'l1', projectId: null, phase: 'review', lessonType: 'success' as const,
      content: '過去の成功例', score: null, retryCount: 0, createdAt: '' }];
    await agent.run({ ...MOCK_CONTEXT_BASE(), lessonsLearned: lessons, previousResults: [] });
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).toContain('過去の成功例');
  });
});

// ─── mockScore (no AI client) ─────────────────────────────────────────────

describe('ReviewAgent — mockScore (no aiClient)', () => {
  function makeResult(files: Array<{ path: string; content: string }>): AgentResult {
    return { ok: true, summary: '', files };
  }

  it('returns 0 for empty previous results', async () => {
    const agent = new ReviewAgent();
    const result = await agent.run({ ...MOCK_CONTEXT_BASE(), previousResults: [] });
    expect(result.ok).toBe(true);
    expect(result.score).toBe(0);
  });

  it('scores 10 points for requirements file', async () => {
    const agent = new ReviewAgent();
    const ctx = {
      ...MOCK_CONTEXT_BASE(),
      previousResults: [makeResult([{ path: 'docs/requirements.md', content: 'x' }])],
    };
    const result = await agent.run(ctx);
    expect(result.score).toBeGreaterThanOrEqual(10);
  });

  it('scores 10 points for basic-design file', async () => {
    const agent = new ReviewAgent();
    const ctx = {
      ...MOCK_CONTEXT_BASE(),
      previousResults: [makeResult([{ path: 'docs/basic-design.md', content: 'x' }])],
    };
    const result = await agent.run(ctx);
    expect(result.score).toBeGreaterThanOrEqual(10);
  });

  it('awards up to 30 points for rich implementation files', async () => {
    const agent = new ReviewAgent();
    const ctx = {
      ...MOCK_CONTEXT_BASE(),
      previousResults: [makeResult([
        { path: 'src/index.ts', content: 'x'.repeat(300) },
      ])],
    };
    const r1 = await agent.run(ctx);
    expect(r1.score).toBeGreaterThanOrEqual(30);
  });

  it('awards up to 30 points for test files with describe/it blocks', async () => {
    const agent = new ReviewAgent();
    const ctx = {
      ...MOCK_CONTEXT_BASE(),
      previousResults: [makeResult([
        { path: 'tests/sample.test.ts', content: 'describe("x", () => { it("does y", () => {}); });' },
      ])],
    };
    const result = await agent.run(ctx);
    expect(result.score).toBeGreaterThanOrEqual(30);
  });

  it('awards 10 points for test-result log', async () => {
    const agent = new ReviewAgent();
    const ctx = {
      ...MOCK_CONTEXT_BASE(),
      previousResults: [makeResult([{ path: 'logs/test-result.md', content: 'pass' }])],
    };
    const result = await agent.run(ctx);
    expect(result.score).toBeGreaterThanOrEqual(10);
  });

  it('full set of artifacts scores 100', async () => {
    const agent = new ReviewAgent();
    const ctx = {
      ...MOCK_CONTEXT_BASE(),
      previousResults: [makeResult([
        { path: 'docs/requirements.md', content: 'req' },
        { path: 'docs/basic-design.md', content: 'basic' },
        { path: 'docs/detailed-design.md', content: 'detailed' },
        { path: 'src/index.ts', content: 'x'.repeat(300) },
        { path: 'src/app.ts', content: 'y' },
        { path: 'tests/sample.test.ts', content: 'describe("x", () => { it("y", () => {}); });' },
        { path: 'logs/test-result.md', content: 'ok' },
      ])],
    };
    const result = await agent.run(ctx);
    expect(result.score).toBe(100);
  });

  it('does not exceed 100 regardless of input', async () => {
    const agent = new ReviewAgent();
    // Many overlapping matching files
    const files = Array.from({ length: 20 }, (_, i) => ({
      path: i % 2 === 0 ? `src/file${i}.ts` : `tests/t${i}.test.ts`,
      content: `describe("x${i}", () => { it("y", () => {}); }); ${'x'.repeat(300)}`,
    }));
    files.push({ path: 'docs/requirements.md', content: 'r' });
    files.push({ path: 'docs/basic-design.md', content: 'b' });
    files.push({ path: 'docs/detailed-design.md', content: 'd' });
    files.push({ path: 'logs/test-result.md', content: 't' });

    const ctx = { ...MOCK_CONTEXT_BASE(), previousResults: [makeResult(files)] };
    const result = await agent.run(ctx);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('includes score in SCORE: line in mock summary', async () => {
    const agent = new ReviewAgent();
    const ctx = { ...MOCK_CONTEXT_BASE(), previousResults: [] };
    const result = await agent.run(ctx);
    const reviewText = (result.data as any)?.review ?? '';
    expect(reviewText).toContain('SCORE:');
  });

  it('returns ok=true even with 0 score', async () => {
    const agent = new ReviewAgent();
    const result = await agent.run({ ...MOCK_CONTEXT_BASE(), previousResults: [] });
    expect(result.ok).toBe(true);
  });
});
