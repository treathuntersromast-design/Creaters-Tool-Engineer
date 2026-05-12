import { parseLineMessage, LineCommand } from '../src/line/messageParser';

const USER_ID = 'U1234567890';

describe('parseLineMessage', () => {
  describe('NEW_PROJECT', () => {
    test.each([
      ['新規プロジェクト: My App', 'My App'],
      ['新規プロジェクト：My App', 'My App'],
      ['新規プロジェクト:  My App ', 'My App'],
      ['新規プロジェクト：　My App', 'My App'],
    ])('parses "%s"', (input, expectedName) => {
      const result = parseLineMessage(input, USER_ID);
      expect(result.type).toBe('NEW_PROJECT');
      if (result.type === 'NEW_PROJECT') {
        expect(result.name).toBe(expectedName);
        expect(result.force).toBe(false);
      }
    });
  });

  describe('NEW_PROJECT_FORCE', () => {
    test.each([
      ['新規プロジェクト!: My App', 'My App'],
      ['新規プロジェクト!：My App', 'My App'],
    ])('parses "%s"', (input, expectedName) => {
      const result = parseLineMessage(input, USER_ID);
      expect(result.type).toBe('NEW_PROJECT_FORCE');
      if (result.type === 'NEW_PROJECT_FORCE') {
        expect(result.name).toBe(expectedName);
        expect(result.force).toBe(true);
      }
    });
  });

  describe('simple commands', () => {
    test.each([
      ['進捗', 'PROGRESS'],
      ['  進捗  ', 'PROGRESS'],
      ['承認', 'APPROVE'],
      ['停止', 'STOP'],
      ['再開', 'RESUME'],
    ] as [string, LineCommand['type']][])('parses "%s" as %s', (input, expectedType) => {
      const result = parseLineMessage(input, USER_ID);
      expect(result.type).toBe(expectedType);
      expect(result.userId).toBe(USER_ID);
    });
  });

  describe('MODIFY', () => {
    test('parses modify with half-width colon', () => {
      const result = parseLineMessage('修正: ログイン機能を追加', USER_ID);
      expect(result.type).toBe('MODIFY');
      if (result.type === 'MODIFY') {
        expect(result.content).toBe('ログイン機能を追加');
      }
    });

    test('parses modify with full-width colon', () => {
      const result = parseLineMessage('修正：ログイン機能を追加', USER_ID);
      expect(result.type).toBe('MODIFY');
    });

    test('returns UNKNOWN for empty modify content', () => {
      const result = parseLineMessage('修正: ', USER_ID);
      expect(result.type).toBe('UNKNOWN');
    });

    test('returns UNKNOWN for modify with only colon', () => {
      const result = parseLineMessage('修正:', USER_ID);
      expect(result.type).toBe('UNKNOWN');
    });
  });

  describe('UNKNOWN', () => {
    test('returns UNKNOWN for unrecognized text', () => {
      const result = parseLineMessage('こんにちは', USER_ID);
      expect(result.type).toBe('UNKNOWN');
      if (result.type === 'UNKNOWN') {
        expect(result.raw).toBe('こんにちは');
      }
    });

    test('returns UNKNOWN for empty string', () => {
      const result = parseLineMessage('', USER_ID);
      expect(result.type).toBe('UNKNOWN');
    });

    test('returns UNKNOWN for partial command', () => {
      const result = parseLineMessage('新規プロジェクト', USER_ID);
      expect(result.type).toBe('UNKNOWN');
    });
  });

  describe('userId', () => {
    test('always includes userId', () => {
      const result = parseLineMessage('進捗', USER_ID);
      expect(result.userId).toBe(USER_ID);
    });
  });
});
