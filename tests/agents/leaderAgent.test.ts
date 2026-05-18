import { LeaderAgent } from '../../src/agents/LeaderAgent';
import { LessonLearned } from '../../src/db/repositories/lessonsLearnedRepository';
import { makeProject, createTestDb } from '../helpers/testDb';

function makeLessons(overrides: Partial<LessonLearned>[] = []): LessonLearned[] {
  return overrides.map((o, i) => ({
    id: `l${i}`,
    projectId: 'proj-1',
    phase: 'implementation',
    lessonType: 'success' as const,
    content: `lesson-${i}`,
    score: null,
    retryCount: 0,
    createdAt: new Date().toISOString(),
    ...o,
  }));
}

function makeCtx(lessonsLearned?: LessonLearned[]) {
  const repos = createTestDb();
  const project = makeProject(repos);
  const task = {
    id: 't1', projectId: project.id, agentId: null, type: 'leader',
    status: 'PENDING', input: null, output: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  } as any;
  return { project, task, lessonsLearned };
}

describe('LeaderAgent.buildKickoffMessage', () => {
  const agent = new LeaderAgent();

  it('includes the project name', () => {
    const msg = agent.buildKickoffMessage('TestApp', []);
    expect(msg).toContain('TestApp');
  });

  it('includes the 4-phase plan header', () => {
    const msg = agent.buildKickoffMessage('App', []);
    expect(msg).toContain('実行計画（Phased Preamble）');
    expect(msg).toContain('フェーズ1');
    expect(msg).toContain('フェーズ2');
    expect(msg).toContain('フェーズ3');
    expect(msg).toContain('フェーズ4');
  });

  it('omits the dreaming block when lessons array is empty', () => {
    const msg = agent.buildKickoffMessage('App', []);
    expect(msg).not.toContain('過去プロジェクトからの洞察');
  });

  it('includes dreaming block when lessons are provided', () => {
    const lessons = makeLessons([{ lessonType: 'success', content: '成功した手法' }]);
    const msg = agent.buildKickoffMessage('App', lessons);
    expect(msg).toContain('過去プロジェクトからの洞察');
  });

  it('shows success/pattern lessons as ✅', () => {
    const lessons = makeLessons([
      { lessonType: 'success', content: '成功A', phase: 'implementation' },
    ]);
    const msg = agent.buildKickoffMessage('App', lessons);
    expect(msg).toContain('✅ 成功パターン');
    expect(msg).toContain('成功A');
  });

  it('shows failure lessons as ⚠️', () => {
    const lessons = makeLessons([
      { lessonType: 'failure', content: '失敗B', phase: 'review' },
    ]);
    const msg = agent.buildKickoffMessage('App', lessons);
    expect(msg).toContain('⚠️ 過去の失敗パターン');
    expect(msg).toContain('失敗B');
  });

  it('shows retry count as 🔄', () => {
    const lessons = makeLessons([
      { lessonType: 'retry', content: '再試行が必要だった', phase: 'testing' },
      { lessonType: 'retry', content: '再試行2', phase: 'implementation' },
    ]);
    const msg = agent.buildKickoffMessage('App', lessons);
    expect(msg).toContain('🔄 再試行が必要だったケース: 2件');
  });

  it('caps success/failure display at 3 each', () => {
    const lessons = makeLessons([
      { lessonType: 'success', content: 'S1' },
      { lessonType: 'success', content: 'S2' },
      { lessonType: 'success', content: 'S3' },
      { lessonType: 'success', content: 'S4' },  // should be truncated
    ]);
    const msg = agent.buildKickoffMessage('App', lessons);
    expect(msg).toContain('S3');
    expect(msg).not.toContain('S4');
  });

  it('handles mixed lesson types', () => {
    const lessons = makeLessons([
      { lessonType: 'success', content: '成功例' },
      { lessonType: 'failure', content: '失敗例' },
      { lessonType: 'retry', content: 'リトライ例' },
      { lessonType: 'pattern', content: 'パターン例' },
    ]);
    const msg = agent.buildKickoffMessage('App', lessons);
    expect(msg).toContain('成功例');
    expect(msg).toContain('失敗例');
    expect(msg).toContain('🔄 再試行が必要だったケース: 1件');
    expect(msg).toContain('パターン例');
  });

  it('pattern lessonType is grouped with success lessons', () => {
    const lessons = makeLessons([
      { lessonType: 'pattern', content: 'パターン手法X', phase: 'design' },
    ]);
    const msg = agent.buildKickoffMessage('App', lessons);
    expect(msg).toContain('✅ 成功パターン');
    expect(msg).toContain('パターン手法X');
  });
});

describe('LeaderAgent.run', () => {
  it('returns ok=true', async () => {
    const agent = new LeaderAgent();
    const result = await agent.run(makeCtx());
    expect(result.ok).toBe(true);
  });

  it('includes lessonsApplied=0 when no lessons', async () => {
    const agent = new LeaderAgent();
    const result = await agent.run(makeCtx([]));
    expect((result.data as any).lessonsApplied).toBe(0);
  });

  it('includes lessonsApplied=N when N lessons provided', async () => {
    const agent = new LeaderAgent();
    const lessons = makeLessons([{ content: 'A' }, { content: 'B' }, { content: 'C' }]);
    const result = await agent.run(makeCtx(lessons));
    expect((result.data as any).lessonsApplied).toBe(3);
  });

  it('includes the dreaming summary in summary when lessons exist', async () => {
    const agent = new LeaderAgent();
    const lessons = makeLessons([
      { lessonType: 'success', content: '過去の成功手法' },
    ]);
    const result = await agent.run(makeCtx(lessons));
    expect(result.summary).toContain('過去プロジェクトからの洞察');
    expect(result.summary).toContain('過去の成功手法');
  });

  it('does not include dreaming block in summary when no lessons', async () => {
    const agent = new LeaderAgent();
    const result = await agent.run(makeCtx([]));
    expect(result.summary).not.toContain('過去プロジェクトからの洞察');
  });

  it('returns hearingAnswers in data.answers', async () => {
    const agent = new LeaderAgent();
    const repos = createTestDb();
    const project = makeProject(repos);
    const task = { id: 't1', projectId: project.id, agentId: null, type: 'leader',
      status: 'PENDING', input: null, output: null,
      createdAt: '', updatedAt: '' } as any;
    const hearingAnswers = repos.hearingAnswerRepo.upsert({
      projectId: project.id,
      purpose: 'ToDoApp', targetUsers: 'users', requiredFeatures: 'CRUD',
      screens: 'yes', techStack: 'React', priority: '1m', deployment: 'Vercel',
      testScope: 'unit', rawText: 'raw',
    });
    const result = await agent.run({ project, task, hearingAnswers, lessonsLearned: [] });
    expect((result.data as any).answers).toBeDefined();
    expect((result.data as any).answers.purpose).toBe('ToDoApp');
  });

  it('handles undefined lessonsLearned gracefully', async () => {
    const agent = new LeaderAgent();
    const result = await agent.run(makeCtx(undefined));
    expect(result.ok).toBe(true);
    expect((result.data as any).lessonsApplied).toBe(0);
  });
});

describe('LeaderAgent.getHearingQuestions / parseHearingReply', () => {
  const agent = new LeaderAgent();

  it('getHearingQuestions returns non-empty string', () => {
    expect(agent.getHearingQuestions().length).toBeGreaterThan(0);
  });

  it('parseHearingReply extracts purpose from numbered list', () => {
    const text = [
      '1. ToDoアプリ',
      '2. 一般ユーザー',
      '3. タスク追加・削除',
      '4. あり',
      '5. React',
      '6. 1ヶ月',
      '7. Vercel',
      '8. 単体テスト',
    ].join('\n');
    const result = agent.parseHearingReply(text);
    expect(result.purpose).toBeTruthy();
    expect(result.rawText).toBe(text);
  });

  it('parseHearingReply returns rawText even for short input', () => {
    const text = '1. purpose only';
    const result = agent.parseHearingReply(text);
    expect(result.rawText).toBe(text);
    // Only one numbered line — all optional fields absent
    expect(result.purpose).toBeTruthy();
    expect(result.targetUsers).toBeUndefined();
  });
});
