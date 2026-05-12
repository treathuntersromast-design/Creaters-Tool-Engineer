import { createTestDb } from '../helpers/testDb';
import { getMissingFields, isComplete, HearingAnswer } from '../../src/db/repositories/hearingAnswerRepository';

const FULL_ANSWERS = {
  purpose:          'アプリの目的',
  targetUsers:      'ユーザー',
  requiredFeatures: '機能一覧',
  screens:          'あり',
  techStack:        'React',
  priority:         '1ヶ月',
  deployment:       'Vercel',
  testScope:        '単体テスト',
  rawText:          'raw',
};

describe('HearingAnswerRepository', () => {
  describe('upsert – create', () => {
    it('creates a new record', () => {
      const repos = createTestDb();
      const p = repos.projectRepo.create({ name: 'P', slug: 's1', userId: 'U', workspacePath: '/tmp' });
      const ans = repos.hearingAnswerRepo.upsert({ projectId: p.id, ...FULL_ANSWERS });
      expect(ans.projectId).toBe(p.id);
      expect(ans.purpose).toBe('アプリの目的');
    });

    it('stores rawText', () => {
      const repos = createTestDb();
      const p = repos.projectRepo.create({ name: 'P', slug: 's2', userId: 'U', workspacePath: '/tmp' });
      const ans = repos.hearingAnswerRepo.upsert({ projectId: p.id, rawText: 'user reply text' });
      expect(ans.rawText).toBe('user reply text');
    });

    it('allows partial fields on creation', () => {
      const repos = createTestDb();
      const p = repos.projectRepo.create({ name: 'P', slug: 's3', userId: 'U', workspacePath: '/tmp' });
      const ans = repos.hearingAnswerRepo.upsert({ projectId: p.id, purpose: 'only purpose' });
      expect(ans.purpose).toBe('only purpose');
      expect(ans.targetUsers).toBeNull();
    });
  });

  describe('upsert – update', () => {
    it('updates existing fields without deleting others', () => {
      const repos = createTestDb();
      const p = repos.projectRepo.create({ name: 'P', slug: 's4', userId: 'U', workspacePath: '/tmp' });
      repos.hearingAnswerRepo.upsert({ projectId: p.id, purpose: 'first' });
      repos.hearingAnswerRepo.upsert({ projectId: p.id, targetUsers: 'updated users' });

      const ans = repos.hearingAnswerRepo.findByProjectId(p.id)!;
      expect(ans.purpose).toBe('first');        // preserved
      expect(ans.targetUsers).toBe('updated users'); // updated
    });

    it('can fill in missing fields over multiple calls', () => {
      const repos = createTestDb();
      const p = repos.projectRepo.create({ name: 'P', slug: 's5', userId: 'U', workspacePath: '/tmp' });
      repos.hearingAnswerRepo.upsert({ projectId: p.id, purpose: 'p' });
      repos.hearingAnswerRepo.upsert({ projectId: p.id, targetUsers: 'u', requiredFeatures: 'f' });
      repos.hearingAnswerRepo.upsert({ projectId: p.id, screens: 'あり', techStack: 'ts', priority: '1m', deployment: 'AWS', testScope: 'unit' });

      const ans = repos.hearingAnswerRepo.findByProjectId(p.id)!;
      expect(isComplete(ans)).toBe(true);
    });

    it('does NOT overwrite existing value with undefined', () => {
      const repos = createTestDb();
      const p = repos.projectRepo.create({ name: 'P', slug: 's6', userId: 'U', workspacePath: '/tmp' });
      repos.hearingAnswerRepo.upsert({ projectId: p.id, purpose: 'original' });
      // update without specifying purpose → should be preserved
      repos.hearingAnswerRepo.upsert({ projectId: p.id, targetUsers: 'new user' });
      expect(repos.hearingAnswerRepo.findByProjectId(p.id)?.purpose).toBe('original');
    });
  });

  describe('findByProjectId', () => {
    it('returns undefined for unknown project', () => {
      const repos = createTestDb();
      expect(repos.hearingAnswerRepo.findByProjectId('non-existent')).toBeUndefined();
    });

    it('returns hearing answers for known project', () => {
      const repos = createTestDb();
      const p = repos.projectRepo.create({ name: 'P', slug: 's7', userId: 'U', workspacePath: '/tmp' });
      repos.hearingAnswerRepo.upsert({ projectId: p.id, purpose: 'test' });
      expect(repos.hearingAnswerRepo.findByProjectId(p.id)).toBeDefined();
    });
  });

  describe('UNIQUE constraint on projectId', () => {
    it('upsert does not create duplicate rows', () => {
      const repos = createTestDb();
      const p = repos.projectRepo.create({ name: 'P', slug: 's8', userId: 'U', workspacePath: '/tmp' });
      repos.hearingAnswerRepo.upsert({ projectId: p.id, purpose: 'a' });
      repos.hearingAnswerRepo.upsert({ projectId: p.id, purpose: 'b' });

      const db = repos.db;
      const count = (db.prepare('SELECT COUNT(*) as n FROM hearing_answers WHERE projectId = ?').get(p.id) as { n: number }).n;
      expect(count).toBe(1);
    });
  });
});

describe('getMissingFields', () => {
  function makeFullAnswer(overrides: Partial<HearingAnswer> = {}): HearingAnswer {
    return {
      id: 'id', projectId: 'pid', updatedAt: new Date().toISOString(),
      ...FULL_ANSWERS,
      ...overrides,
    };
  }

  it('returns [] when all 8 fields are filled', () => {
    expect(getMissingFields(makeFullAnswer())).toHaveLength(0);
  });

  it('returns missing field name when one is null', () => {
    expect(getMissingFields(makeFullAnswer({ purpose: null }))).toEqual(['purpose']);
  });

  it('returns all 8 when completely empty', () => {
    const empty = makeFullAnswer({
      purpose: null, targetUsers: null, requiredFeatures: null, screens: null,
      techStack: null, priority: null, deployment: null, testScope: null,
    });
    expect(getMissingFields(empty)).toHaveLength(8);
  });

  it('does NOT include rawText as required', () => {
    expect(getMissingFields(makeFullAnswer({ rawText: null }))).toHaveLength(0);
  });
});

describe('isComplete', () => {
  it('true when all fields present', () => {
    const a: HearingAnswer = {
      id: 'i', projectId: 'p', updatedAt: 'now',
      ...FULL_ANSWERS,
    };
    expect(isComplete(a)).toBe(true);
  });

  it('false when any field is null', () => {
    const a: HearingAnswer = {
      id: 'i', projectId: 'p', updatedAt: 'now',
      ...FULL_ANSWERS,
      testScope: null,
    };
    expect(isComplete(a)).toBe(false);
  });

  it('false when multiple fields are null', () => {
    const a: HearingAnswer = {
      id: 'i', projectId: 'p', updatedAt: 'now', rawText: null,
      purpose: 'p', targetUsers: null, requiredFeatures: null,
      screens: null, techStack: null, priority: null, deployment: null, testScope: null,
    };
    expect(isComplete(a)).toBe(false);
  });
});
