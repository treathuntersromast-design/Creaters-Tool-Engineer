import {
  generateRequirements,
  generateBasicDesign,
  generateDetailedDesign,
  generateTestResult,
  generateSampleTest,
  generateRevision,
} from '../../src/documents/documentGenerator';
import { HearingAnswer } from '../../src/db/repositories/hearingAnswerRepository';

const SAMPLE_ANSWERS: HearingAnswer = {
  id: 'id-1',
  projectId: 'proj-1',
  updatedAt: '2024-01-01T00:00:00.000Z',
  rawText: null,
  purpose: 'ToDoリスト管理アプリ',
  targetUsers: '一般ユーザー',
  requiredFeatures: 'タスク追加・削除・完了',
  screens: 'あり',
  techStack: 'React + TypeScript',
  priority: '1ヶ月以内',
  deployment: 'Vercel',
  testScope: '単体テストのみ',
};

describe('generateRequirements', () => {
  it('returns path docs/requirements.md', () => {
    const doc = generateRequirements(SAMPLE_ANSWERS, 'My App');
    expect(doc.path).toBe('docs/requirements.md');
  });

  it('includes project name in content', () => {
    const doc = generateRequirements(SAMPLE_ANSWERS, 'My App');
    expect(doc.content).toContain('My App');
  });

  it('includes hearing answer content', () => {
    const doc = generateRequirements(SAMPLE_ANSWERS, 'My App');
    expect(doc.content).toContain('ToDoリスト管理アプリ');
  });

  it('includes target users', () => {
    const doc = generateRequirements(SAMPLE_ANSWERS, 'My App');
    expect(doc.content).toContain('一般ユーザー');
  });

  it('returns non-empty content', () => {
    const doc = generateRequirements(SAMPLE_ANSWERS, 'My App');
    expect(doc.content.length).toBeGreaterThan(50);
  });
});

describe('generateBasicDesign', () => {
  it('returns path docs/basic-design.md', () => {
    const doc = generateBasicDesign(SAMPLE_ANSWERS, 'My App');
    expect(doc.path).toBe('docs/basic-design.md');
  });

  it('returns non-empty content', () => {
    const doc = generateBasicDesign(SAMPLE_ANSWERS, 'My App');
    expect(doc.content.length).toBeGreaterThan(0);
  });

  it('includes project name', () => {
    const doc = generateBasicDesign(SAMPLE_ANSWERS, 'Fancy App');
    expect(doc.content).toContain('Fancy App');
  });
});

describe('generateDetailedDesign', () => {
  it('returns path docs/detailed-design.md', () => {
    const doc = generateDetailedDesign(SAMPLE_ANSWERS, 'My App');
    expect(doc.path).toBe('docs/detailed-design.md');
  });

  it('returns non-empty content', () => {
    const doc = generateDetailedDesign(SAMPLE_ANSWERS, 'My App');
    expect(doc.content.length).toBeGreaterThan(0);
  });

  it('includes project name in content', () => {
    const doc = generateDetailedDesign(SAMPLE_ANSWERS, 'My App');
    expect(doc.content).toContain('My App');
  });
});

describe('generateTestResult', () => {
  it('returns path logs/test-result.md', () => {
    const doc = generateTestResult('My App');
    expect(doc.path).toBe('logs/test-result.md');
  });

  it('includes project name', () => {
    const doc = generateTestResult('Super App');
    expect(doc.content).toContain('Super App');
  });

  it('returns non-empty content', () => {
    const doc = generateTestResult('My App');
    expect(doc.content.length).toBeGreaterThan(0);
  });
});

describe('generateSampleTest', () => {
  it('returns path tests/sample.test.ts', () => {
    const doc = generateSampleTest('My App');
    expect(doc.path).toBe('tests/sample.test.ts');
  });

  it('contains describe block (TypeScript test syntax)', () => {
    const doc = generateSampleTest('My App');
    expect(doc.content).toContain('describe');
  });

  it('returns non-empty content', () => {
    const doc = generateSampleTest('My App');
    expect(doc.content.length).toBeGreaterThan(0);
  });
});

describe('generateRevision', () => {
  it('returns correct path for revision 1', () => {
    const doc = generateRevision('Add login feature', 1);
    expect(doc.path).toBe('docs/revisions/revision-1.md');
  });

  it('returns correct path for revision 3', () => {
    const doc = generateRevision('Fix bug', 3);
    expect(doc.path).toBe('docs/revisions/revision-3.md');
  });

  it('includes revision content', () => {
    const doc = generateRevision('ログイン機能を追加してください', 1);
    expect(doc.content).toContain('ログイン機能を追加してください');
  });

  it('includes revision number heading', () => {
    const doc = generateRevision('some change', 2);
    expect(doc.content).toContain('# 修正依頼 #2');
  });

  it('returns non-empty content', () => {
    const doc = generateRevision('change', 1);
    expect(doc.content.length).toBeGreaterThan(10);
  });

  it('revision 10 uses correct path', () => {
    const doc = generateRevision('big change', 10);
    expect(doc.path).toBe('docs/revisions/revision-10.md');
  });
});
