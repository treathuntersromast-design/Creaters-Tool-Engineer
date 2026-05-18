import { ImplementationAgent } from '../../src/agents/ImplementationAgent';
import { MockCodeExecutor } from '../../src/executors/MockCodeExecutor';
import { AgentContext } from '../../src/agents/Agent';
import { makeProject, makeHearingAnswers, createTestDb } from '../helpers/testDb';

function makeCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  const repos = createTestDb();
  const project = makeProject(repos);
  const task = {
    id: 't1', projectId: project.id, agentId: null, type: 'implementation',
    status: 'PENDING', input: null, output: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  } as any;
  const hearingAnswers = makeHearingAnswers(repos, project.id);
  return { project, task, hearingAnswers, previousResults: [], ...overrides };
}

// ─── Mock executor (no AI) ────────────────────────────────────────────────

describe('ImplementationAgent — mock executor', () => {
  it('returns ok=true', async () => {
    const agent = new ImplementationAgent(new MockCodeExecutor());
    const result = await agent.run(makeCtx());
    expect(result.ok).toBe(true);
  });

  it('generates src/index.ts and src/app.ts', async () => {
    const agent = new ImplementationAgent(new MockCodeExecutor());
    const result = await agent.run(makeCtx());
    const paths = result.files?.map((f) => f.path) ?? [];
    expect(paths).toContain('src/index.ts');
    expect(paths).toContain('src/app.ts');
  });

  it('includes project name in generated code', async () => {
    const agent = new ImplementationAgent(new MockCodeExecutor());
    const result = await agent.run(makeCtx());
    const combined = result.files?.map((f) => f.content).join('') ?? '';
    expect(combined).toContain('Test Project');
  });
});

// ─── parseFiles (via AI mock) ─────────────────────────────────────────────

describe('ImplementationAgent — parseFiles (via AI mock)', () => {
  function makeMockClient(response: string) {
    return { generate: jest.fn().mockResolvedValue(response) };
  }

  it('parses a single FILE block', async () => {
    const raw = '---FILE: src/index.ts---\nconsole.log("hello");\n';
    const agent = new ImplementationAgent(new MockCodeExecutor(), makeMockClient(raw) as any);
    const result = await agent.run(makeCtx());
    expect(result.ok).toBe(true);
    expect(result.files?.length).toBe(1);
    expect(result.files?.[0].path).toBe('src/index.ts');
    expect(result.files?.[0].content).toBe('console.log("hello");');
  });

  it('parses two FILE blocks', async () => {
    const raw = [
      '---FILE: src/index.ts---',
      'const a = 1;',
      '---FILE: src/app.ts---',
      'const b = 2;',
    ].join('\n');
    const agent = new ImplementationAgent(new MockCodeExecutor(), makeMockClient(raw) as any);
    const result = await agent.run(makeCtx());
    expect(result.ok).toBe(true);
    expect(result.files?.length).toBe(2);
    expect(result.files?.map((f) => f.path)).toContain('src/index.ts');
    expect(result.files?.map((f) => f.path)).toContain('src/app.ts');
  });

  it('returns ok=false when no FILE blocks in response', async () => {
    const agent = new ImplementationAgent(new MockCodeExecutor(), makeMockClient('no file headers here') as any);
    const result = await agent.run(makeCtx());
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No files parsed');
  });

  it('returns ok=false when FILE block exists but content is empty after trim', async () => {
    const raw = '---FILE: src/empty.ts---\n   \n';
    const agent = new ImplementationAgent(new MockCodeExecutor(), makeMockClient(raw) as any);
    const result = await agent.run(makeCtx());
    expect(result.ok).toBe(false);
  });

  it('trims whitespace from file content', async () => {
    const raw = '---FILE: src/index.ts---\n\n  const x = 1;  \n\n';
    const agent = new ImplementationAgent(new MockCodeExecutor(), makeMockClient(raw) as any);
    const result = await agent.run(makeCtx());
    expect(result.files?.[0].content).toBe('const x = 1;');
  });

  it('handles FILE header with extra spaces', async () => {
    const raw = '---FILE:   src/index.ts  ---\nconst z = 3;\n';
    const agent = new ImplementationAgent(new MockCodeExecutor(), makeMockClient(raw) as any);
    const result = await agent.run(makeCtx());
    expect(result.ok).toBe(true);
    expect(result.files?.[0].path).toBe('src/index.ts');
  });
});

// ─── Pattern 3: architectureContext injection ─────────────────────────────

describe('ImplementationAgent — architectureContext (Pattern 3)', () => {
  it('injects arch decisions into userPrompt', async () => {
    const spy = jest.fn().mockResolvedValue('---FILE: src/index.ts---\ncode\n');
    const agent = new ImplementationAgent(new MockCodeExecutor(), { generate: spy } as any);
    const ctx = makeCtx({
      architectureContext: { decisions: 'アーキテクチャ決定: モノリシック', techStack: 'TS' },
    });
    await agent.run(ctx);
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).toContain('アーキテクチャ決定: モノリシック');
  });

  it('does not include arch section when architectureContext is absent', async () => {
    const spy = jest.fn().mockResolvedValue('---FILE: src/index.ts---\ncode\n');
    const agent = new ImplementationAgent(new MockCodeExecutor(), { generate: spy } as any);
    await agent.run(makeCtx());
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).not.toContain('アーキテクチャ決定');
  });
});

// ─── Retry note (Pattern 2) ────────────────────────────────────────────────

describe('ImplementationAgent — retryCount note', () => {
  it('includes retry note when retryCount=1', async () => {
    const spy = jest.fn().mockResolvedValue('---FILE: src/index.ts---\ncode\n');
    const agent = new ImplementationAgent(new MockCodeExecutor(), { generate: spy } as any);
    await agent.run(makeCtx({ retryCount: 1 }));
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).toContain('再試行 #1');
  });

  it('includes retry note when retryCount=2', async () => {
    const spy = jest.fn().mockResolvedValue('---FILE: src/index.ts---\ncode\n');
    const agent = new ImplementationAgent(new MockCodeExecutor(), { generate: spy } as any);
    await agent.run(makeCtx({ retryCount: 2 }));
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).toContain('再試行 #2');
  });

  it('does NOT include retry note when retryCount=0', async () => {
    const spy = jest.fn().mockResolvedValue('---FILE: src/index.ts---\ncode\n');
    const agent = new ImplementationAgent(new MockCodeExecutor(), { generate: spy } as any);
    await agent.run(makeCtx({ retryCount: 0 }));
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).not.toContain('再試行');
  });

  it('does NOT include retry note when retryCount is undefined', async () => {
    const spy = jest.fn().mockResolvedValue('---FILE: src/index.ts---\ncode\n');
    const agent = new ImplementationAgent(new MockCodeExecutor(), { generate: spy } as any);
    await agent.run(makeCtx({ retryCount: undefined }));
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).not.toContain('再試行');
  });
});

// ─── revisionContent + lessonsLearned injection ───────────────────────────

describe('ImplementationAgent — revision and lessons injection', () => {
  it('prepends revisionContent when provided', async () => {
    const spy = jest.fn().mockResolvedValue('---FILE: src/index.ts---\ncode\n');
    const agent = new ImplementationAgent(new MockCodeExecutor(), { generate: spy } as any);
    await agent.run(makeCtx({ revisionContent: 'ログイン機能を追加してください' }));
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).toContain('ログイン機能を追加してください');
  });

  it('does not add revision block when revisionContent is undefined', async () => {
    const spy = jest.fn().mockResolvedValue('---FILE: src/index.ts---\ncode\n');
    const agent = new ImplementationAgent(new MockCodeExecutor(), { generate: spy } as any);
    await agent.run(makeCtx({ revisionContent: undefined }));
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).not.toContain('修正依頼');
  });

  it('injects lessonsLearned into userPrompt', async () => {
    const spy = jest.fn().mockResolvedValue('---FILE: src/index.ts---\ncode\n');
    const agent = new ImplementationAgent(new MockCodeExecutor(), { generate: spy } as any);
    const lessons = [{
      id: 'l1', projectId: null, phase: 'implementation', lessonType: 'failure' as const,
      content: 'SQLインジェクション対策を忘れない', score: null, retryCount: 0, createdAt: '',
    }];
    await agent.run(makeCtx({ lessonsLearned: lessons }));
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).toContain('SQLインジェクション対策を忘れない');
  });

  it('uses detailed-design from previousResults', async () => {
    const spy = jest.fn().mockResolvedValue('---FILE: src/index.ts---\ncode\n');
    const agent = new ImplementationAgent(new MockCodeExecutor(), { generate: spy } as any);
    const ctx = makeCtx({
      previousResults: [{
        ok: true, summary: '',
        files: [{ path: 'docs/detailed-design.md', content: '詳細設計の内容' }],
      }],
    });
    await agent.run(ctx);
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).toContain('詳細設計の内容');
  });
});

// ─── Error handling ────────────────────────────────────────────────────────

describe('ImplementationAgent — AI error handling', () => {
  it('returns ok=false on AI client error', async () => {
    const failClient = { generate: jest.fn().mockRejectedValue(new Error('timeout')) };
    const agent = new ImplementationAgent(new MockCodeExecutor(), failClient as any);
    const result = await agent.run(makeCtx());
    expect(result.ok).toBe(false);
    expect(result.error).toContain('timeout');
  });

  it('returns ok=false on non-Error rejection', async () => {
    const failClient = { generate: jest.fn().mockRejectedValue('string error') };
    const agent = new ImplementationAgent(new MockCodeExecutor(), failClient as any);
    const result = await agent.run(makeCtx());
    expect(result.ok).toBe(false);
    expect(result.error).toBe('string error');
  });
});
