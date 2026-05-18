import { DesignAgent } from '../../src/agents/DesignAgent';
import { AgentContext, ArchitectureContext } from '../../src/agents/Agent';
import { makeProject, makeHearingAnswers, createTestDb } from '../helpers/testDb';

function makeCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  const repos = createTestDb();
  const project = makeProject(repos);
  const task = {
    id: 't1', projectId: project.id, agentId: null, type: 'design',
    status: 'PENDING', input: null, output: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  } as any;
  const hearingAnswers = makeHearingAnswers(repos, project.id);
  return { project, task, hearingAnswers, previousResults: [], ...overrides };
}

// ─── Basic design (mock mode) ─────────────────────────────────────────────

describe('DesignAgent (basic_design) — mock mode', () => {
  it('returns ok=true', async () => {
    const agent = new DesignAgent('basic_design');
    const result = await agent.run(makeCtx());
    expect(result.ok).toBe(true);
  });

  it('generates docs/basic-design.md file', async () => {
    const agent = new DesignAgent('basic_design');
    const result = await agent.run(makeCtx());
    expect(result.files?.some((f) => f.path === 'docs/basic-design.md')).toBe(true);
  });

  it('puts architectureContext in data', async () => {
    const agent = new DesignAgent('basic_design');
    const result = await agent.run(makeCtx());
    const data = result.data as any;
    expect(data?.architectureContext).toBeDefined();
    expect(data.architectureContext.decisions).toBeTruthy();
    expect(data.architectureContext.techStack).toBeTruthy();
  });

  it('reflects techStack from hearingAnswers', async () => {
    const repos = createTestDb();
    const project = makeProject(repos);
    const task = { id: 't', projectId: project.id, agentId: null, type: 'd',
      status: 'PENDING', input: null, output: null, createdAt: '', updatedAt: '' } as any;
    repos.hearingAnswerRepo.upsert({
      projectId: project.id, purpose: 'x', targetUsers: 'y', requiredFeatures: 'z',
      screens: 'y', techStack: 'Vue + Node.js', priority: '1m', deployment: 'AWS',
      testScope: 'unit', rawText: 'raw',
    });
    const hearingAnswers = repos.hearingAnswerRepo.findByProjectId(project.id)!;
    const agent = new DesignAgent('basic_design');
    const result = await agent.run({ project, task, hearingAnswers, previousResults: [] });
    const data = result.data as any;
    expect(data?.architectureContext?.techStack).toBe('Vue + Node.js');
  });

  it('returns ok=false when hearingAnswers is undefined', async () => {
    const repos = createTestDb();
    const project = makeProject(repos);
    const task = { id: 't', projectId: project.id, agentId: null, type: 'd',
      status: 'PENDING', input: null, output: null, createdAt: '', updatedAt: '' } as any;
    const agent = new DesignAgent('basic_design');
    const result = await agent.run({ project, task });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('No hearing answers');
  });
});

// ─── Detailed design (mock mode) ─────────────────────────────────────────

describe('DesignAgent (detailed_design) — mock mode', () => {
  it('returns ok=true', async () => {
    const agent = new DesignAgent('detailed_design');
    const result = await agent.run(makeCtx());
    expect(result.ok).toBe(true);
  });

  it('generates docs/detailed-design.md file', async () => {
    const agent = new DesignAgent('detailed_design');
    const result = await agent.run(makeCtx());
    expect(result.files?.some((f) => f.path === 'docs/detailed-design.md')).toBe(true);
  });

  it('does NOT put architectureContext in data for detailed_design', async () => {
    const agent = new DesignAgent('detailed_design');
    const result = await agent.run(makeCtx());
    const data = result.data as any;
    // data should be undefined for detailed design
    expect(data?.architectureContext).toBeUndefined();
  });

  it('uses architectureContext.decisions if provided', async () => {
    const archCtx: ArchitectureContext = {
      decisions: '# Arch決定: モノリシック構成',
      techStack: 'Node.js',
    };
    const ctx = makeCtx({ architectureContext: archCtx });
    // In mock mode this doesn't change output significantly,
    // but the agent must not crash
    const agent = new DesignAgent('detailed_design');
    const result = await agent.run(ctx);
    expect(result.ok).toBe(true);
  });
});

// ─── AI mode ────────────────────────────────────────────────────────────

describe('DesignAgent — AI mode', () => {
  const mockContent = '# 基本設計書\n## 1. システム概要\nシステム説明\n## 9. 技術スタック';

  function makeMockClient(content = mockContent) {
    return { generate: jest.fn().mockResolvedValue(content) };
  }

  it('basic_design returns architectureContext from AI response', async () => {
    const aiClient = makeMockClient();
    const agent = new DesignAgent('basic_design', aiClient as any);
    const result = await agent.run(makeCtx());
    const data = result.data as any;
    expect(data?.architectureContext?.decisions).toBe(mockContent);
  });

  it('detailed_design does not include architectureContext in data', async () => {
    const aiClient = makeMockClient();
    const agent = new DesignAgent('detailed_design', aiClient as any);
    const result = await agent.run(makeCtx());
    expect((result.data as any)?.architectureContext).toBeUndefined();
  });

  it('injects requirements doc from previousResults for basic_design', async () => {
    const spy = jest.fn().mockResolvedValue(mockContent);
    const agent = new DesignAgent('basic_design', { generate: spy } as any);
    const ctx = makeCtx({
      previousResults: [{
        ok: true, summary: '',
        files: [{ path: 'docs/requirements.md', content: 'req content here' }],
      }],
    });
    await agent.run(ctx);
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).toContain('req content here');
  });

  it('uses architectureContext.decisions for detailed_design prompt (Pattern 3)', async () => {
    const spy = jest.fn().mockResolvedValue('detailed doc');
    const agent = new DesignAgent('detailed_design', { generate: spy } as any);
    const ctx = makeCtx({
      architectureContext: { decisions: 'arch_decision_content', techStack: 'TS' },
    });
    await agent.run(ctx);
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).toContain('arch_decision_content');
  });

  it('injects revisionContent when provided', async () => {
    const spy = jest.fn().mockResolvedValue(mockContent);
    const agent = new DesignAgent('basic_design', { generate: spy } as any);
    const ctx = makeCtx({ revisionContent: 'UIを全面刷新する' });
    await agent.run(ctx);
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).toContain('UIを全面刷新する');
  });

  it('injects lessonsLearned into user prompt', async () => {
    const spy = jest.fn().mockResolvedValue(mockContent);
    const agent = new DesignAgent('basic_design', { generate: spy } as any);
    const lessons = [{
      id: 'l1', projectId: null, phase: 'design', lessonType: 'success' as const,
      content: '前回の学習内容', score: null, retryCount: 0, createdAt: '',
    }];
    const ctx = makeCtx({ lessonsLearned: lessons });
    await agent.run(ctx);
    const [, userPrompt] = spy.mock.calls[0] as [string, string];
    expect(userPrompt).toContain('前回の学習内容');
  });

  it('returns ok=false on AI error', async () => {
    const failClient = { generate: jest.fn().mockRejectedValue(new Error('network error')) };
    const agent = new DesignAgent('basic_design', failClient as any);
    const result = await agent.run(makeCtx());
    expect(result.ok).toBe(false);
    expect(result.error).toContain('network error');
  });
});

// ─── Name / role ──────────────────────────────────────────────────────────

describe('DesignAgent name and role', () => {
  it('basic_design agent has name BasicDesignAgent', () => {
    const agent = new DesignAgent('basic_design');
    expect(agent.name).toBe('BasicDesignAgent');
    expect(agent.role).toBe('basic_design');
  });

  it('detailed_design agent has name DetailedDesignAgent', () => {
    const agent = new DesignAgent('detailed_design');
    expect(agent.name).toBe('DetailedDesignAgent');
    expect(agent.role).toBe('detailed_design');
  });
});
