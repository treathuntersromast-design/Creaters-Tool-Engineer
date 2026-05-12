import { parseHearingReply } from '../src/hearing/hearingParser';
import { getMissingFields, isComplete } from '../src/db/repositories/hearingAnswerRepository';
import { HearingAnswer } from '../src/db/repositories/hearingAnswerRepository';

describe('parseHearingReply', () => {
  describe('numbered format', () => {
    test('extracts 8 numbered answers', () => {
      const text = [
        '1. ToDoリスト管理アプリ',
        '2. 一般ユーザー',
        '3. タスク追加・削除・完了',
        '4. あり',
        '5. React + TypeScript',
        '6. 1ヶ月以内',
        '7. Vercel',
        '8. 単体テストのみ',
      ].join('\n');

      const result = parseHearingReply(text);
      expect(result.purpose).toBeTruthy();
      expect(result.rawText).toBe(text);
    });
  });

  describe('sequential format', () => {
    test('extracts answers from plain lines', () => {
      const text = [
        'ToDoリスト管理アプリです',
        '一般ユーザー向けです',
        'タスク追加・削除・完了機能',
        'UI画面あり',
        'React使いたいです',
        '1ヶ月',
        'Vercel',
        '単体テストのみ',
      ].join('\n');

      const result = parseHearingReply(text);
      expect(result.purpose).toBeTruthy();
      expect(result.rawText).toBe(text);
    });
  });

  describe('always includes rawText', () => {
    test('rawText is preserved', () => {
      const text = 'テストアプリ\nユーザー\n機能';
      const result = parseHearingReply(text);
      expect(result.rawText).toBe(text);
    });
  });
});

describe('getMissingFields', () => {
  const makeAnswer = (overrides: Partial<HearingAnswer> = {}): HearingAnswer => ({
    id: 'test-id',
    projectId: 'test-project',
    purpose: 'アプリ目的',
    targetUsers: 'ユーザー',
    requiredFeatures: '機能',
    screens: 'あり',
    techStack: 'React',
    priority: '1ヶ月',
    deployment: 'Vercel',
    testScope: '単体テスト',
    rawText: 'raw',
    updatedAt: new Date().toISOString(),
    ...overrides,
  });

  test('returns empty array when all fields are filled', () => {
    const answer = makeAnswer();
    expect(getMissingFields(answer)).toHaveLength(0);
  });

  test('returns missing field names', () => {
    const answer = makeAnswer({ purpose: null });
    expect(getMissingFields(answer)).toContain('purpose');
  });

  test('returns multiple missing fields', () => {
    const answer = makeAnswer({ purpose: null, targetUsers: null });
    const missing = getMissingFields(answer);
    expect(missing).toContain('purpose');
    expect(missing).toContain('targetUsers');
  });
});

describe('isComplete', () => {
  test('returns true when all required fields are set', () => {
    const answer: HearingAnswer = {
      id: 'id',
      projectId: 'pid',
      purpose: 'p',
      targetUsers: 'u',
      requiredFeatures: 'f',
      screens: 'あり',
      techStack: 'React',
      priority: '1ヶ月',
      deployment: 'Vercel',
      testScope: 'unit',
      rawText: 'raw',
      updatedAt: new Date().toISOString(),
    };
    expect(isComplete(answer)).toBe(true);
  });

  test('returns false when any field is missing', () => {
    const answer: HearingAnswer = {
      id: 'id',
      projectId: 'pid',
      purpose: null,
      targetUsers: 'u',
      requiredFeatures: 'f',
      screens: 'あり',
      techStack: 'React',
      priority: '1ヶ月',
      deployment: 'Vercel',
      testScope: 'unit',
      rawText: 'raw',
      updatedAt: new Date().toISOString(),
    };
    expect(isComplete(answer)).toBe(false);
  });
});
