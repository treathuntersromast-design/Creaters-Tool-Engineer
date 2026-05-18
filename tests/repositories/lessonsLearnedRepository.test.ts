import { createTestDb, makeProject } from '../helpers/testDb';
import { LessonsLearnedRepository } from '../../src/db/repositories/lessonsLearnedRepository';

function buildRepo() {
  const repos = createTestDb();
  const repo = new LessonsLearnedRepository(repos.db);
  return { repo, repos };
}

describe('LessonsLearnedRepository.save', () => {
  it('saves a lesson and returns it with id and createdAt', () => {
    const { repo, repos } = buildRepo();
    const proj = makeProject(repos);
    const saved = repo.save({
      projectId: proj.id,
      phase: 'implementation',
      lessonType: 'success',
      content: 'TypeScriptのstrictモードを有効にすること',
      score: 90,
      retryCount: 0,
    });

    expect(saved.id).toBeTruthy();
    expect(saved.id.length).toBeGreaterThanOrEqual(8);
    expect(saved.projectId).toBe(proj.id);
    expect(saved.phase).toBe('implementation');
    expect(saved.lessonType).toBe('success');
    expect(saved.content).toBe('TypeScriptのstrictモードを有効にすること');
    expect(saved.score).toBe(90);
    expect(saved.retryCount).toBe(0);
    expect(saved.createdAt).toBeTruthy();
  });

  it('accepts null projectId', () => {
    const { repo } = buildRepo();
    const saved = repo.save({
      projectId: null,
      phase: 'review',
      lessonType: 'failure',
      content: 'テストカバレッジが不足していた',
      score: null,
      retryCount: 1,
    });
    expect(saved.projectId).toBeNull();
    expect(saved.id).toBeTruthy();
  });

  it('accepts null score', () => {
    const { repo } = buildRepo();
    const saved = repo.save({
      projectId: null,
      phase: 'testing',
      lessonType: 'retry',
      content: 'E2Eテストが壊れた',
      score: null,
      retryCount: 2,
    });
    expect(saved.score).toBeNull();
  });

  it('generates unique ids for each save', () => {
    const { repo } = buildRepo();
    const a = repo.save({ projectId: null, phase: 'p', lessonType: 'pattern', content: 'A', score: null, retryCount: 0 });
    const b = repo.save({ projectId: null, phase: 'p', lessonType: 'pattern', content: 'B', score: null, retryCount: 0 });
    expect(a.id).not.toBe(b.id);
  });

  it('persists all four lessonType values', () => {
    const { repo } = buildRepo();
    for (const type of ['failure', 'success', 'retry', 'pattern'] as const) {
      const saved = repo.save({ projectId: null, phase: 'x', lessonType: type, content: type, score: null, retryCount: 0 });
      expect(saved.lessonType).toBe(type);
    }
  });
});

describe('LessonsLearnedRepository.findRecent', () => {
  it('returns empty array when no lessons', () => {
    const { repo } = buildRepo();
    expect(repo.findRecent()).toEqual([]);
  });

  it('returns lessons ordered by createdAt DESC', async () => {
    const { repo } = buildRepo();
    repo.save({ projectId: null, phase: 'a', lessonType: 'success', content: 'first', score: null, retryCount: 0 });
    await new Promise((r) => setTimeout(r, 5));
    repo.save({ projectId: null, phase: 'b', lessonType: 'failure', content: 'second', score: null, retryCount: 0 });

    const results = repo.findRecent(10);
    expect(results[0].content).toBe('second');
    expect(results[1].content).toBe('first');
  });

  it('respects the limit parameter', () => {
    const { repo } = buildRepo();
    for (let i = 0; i < 8; i++) {
      repo.save({ projectId: null, phase: 'p', lessonType: 'success', content: `lesson-${i}`, score: null, retryCount: 0 });
    }
    const results = repo.findRecent(3);
    expect(results.length).toBe(3);
  });

  it('defaults to 10 lessons when limit omitted', () => {
    const { repo } = buildRepo();
    for (let i = 0; i < 15; i++) {
      repo.save({ projectId: null, phase: 'p', lessonType: 'success', content: `l-${i}`, score: null, retryCount: 0 });
    }
    expect(repo.findRecent().length).toBe(10);
  });

  it('filters by lessonType when provided', () => {
    const { repo } = buildRepo();
    repo.save({ projectId: null, phase: 'p', lessonType: 'success', content: 'ok', score: null, retryCount: 0 });
    repo.save({ projectId: null, phase: 'q', lessonType: 'failure', content: 'bad', score: null, retryCount: 0 });
    repo.save({ projectId: null, phase: 'r', lessonType: 'failure', content: 'bad2', score: null, retryCount: 0 });

    const failures = repo.findRecent(10, 'failure');
    expect(failures.length).toBe(2);
    expect(failures.every((l) => l.lessonType === 'failure')).toBe(true);

    const successes = repo.findRecent(10, 'success');
    expect(successes.length).toBe(1);
  });

  it('returns empty when filtering type that does not exist', () => {
    const { repo } = buildRepo();
    repo.save({ projectId: null, phase: 'p', lessonType: 'success', content: 'x', score: null, retryCount: 0 });
    expect(repo.findRecent(10, 'retry')).toEqual([]);
  });
});

describe('LessonsLearnedRepository.findByPhase', () => {
  it('returns empty array for unknown phase', () => {
    const { repo } = buildRepo();
    expect(repo.findByPhase('nonexistent')).toEqual([]);
  });

  it('returns only lessons for the specified phase', () => {
    const { repo } = buildRepo();
    repo.save({ projectId: null, phase: 'implementation', lessonType: 'success', content: 'impl-lesson', score: null, retryCount: 0 });
    repo.save({ projectId: null, phase: 'review', lessonType: 'failure', content: 'review-lesson', score: null, retryCount: 0 });

    const impl = repo.findByPhase('implementation');
    expect(impl.length).toBe(1);
    expect(impl[0].content).toBe('impl-lesson');
  });

  it('respects limit parameter', () => {
    const { repo } = buildRepo();
    for (let i = 0; i < 8; i++) {
      repo.save({ projectId: null, phase: 'testing', lessonType: 'pattern', content: `t-${i}`, score: null, retryCount: 0 });
    }
    expect(repo.findByPhase('testing', 3).length).toBe(3);
  });

  it('defaults to 5 when limit omitted', () => {
    const { repo } = buildRepo();
    for (let i = 0; i < 8; i++) {
      repo.save({ projectId: null, phase: 'testing', lessonType: 'pattern', content: `t-${i}`, score: null, retryCount: 0 });
    }
    expect(repo.findByPhase('testing').length).toBe(5);
  });
});

describe('LessonsLearnedRepository.findByProjectId', () => {
  it('returns empty array for unknown projectId', () => {
    const { repo } = buildRepo();
    expect(repo.findByProjectId('no-such-project')).toEqual([]);
  });

  it('returns only lessons for the specified project', () => {
    const { repo, repos } = buildRepo();
    const projA = makeProject(repos, { slug: `slug-a-${Date.now()}` });
    const projB = makeProject(repos, { slug: `slug-b-${Date.now()}` });
    repo.save({ projectId: projA.id, phase: 'implementation', lessonType: 'success', content: 'A-lesson', score: null, retryCount: 0 });
    repo.save({ projectId: projB.id, phase: 'review', lessonType: 'failure', content: 'B-lesson', score: null, retryCount: 0 });

    const results = repo.findByProjectId(projA.id);
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('A-lesson');
  });

  it('returns multiple lessons for same project ordered ASC', async () => {
    const { repo, repos } = buildRepo();
    const projX = makeProject(repos, { slug: `slug-x-${Date.now()}` });
    repo.save({ projectId: projX.id, phase: 'p1', lessonType: 'success', content: 'first', score: null, retryCount: 0 });
    await new Promise((r) => setTimeout(r, 5));
    repo.save({ projectId: projX.id, phase: 'p2', lessonType: 'success', content: 'second', score: null, retryCount: 0 });

    const results = repo.findByProjectId(projX.id);
    expect(results.length).toBe(2);
    expect(results[0].content).toBe('first');
    expect(results[1].content).toBe('second');
  });

  it('does not include lessons with null projectId', () => {
    const { repo, repos } = buildRepo();
    const projY = makeProject(repos, { slug: `slug-y-${Date.now()}` });
    repo.save({ projectId: null, phase: 'p', lessonType: 'success', content: 'global', score: null, retryCount: 0 });
    repo.save({ projectId: projY.id, phase: 'p', lessonType: 'success', content: 'local', score: null, retryCount: 0 });

    const results = repo.findByProjectId(projY.id);
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('local');
  });
});
