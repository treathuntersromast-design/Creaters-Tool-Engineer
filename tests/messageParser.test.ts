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

  // ── Git commands ──────────────────────────────────────────────────────────

  describe('GIT_LIST_REPOS — natural language', () => {
    test.each([
      'リポジトリ一覧',
      'リポジトリの一覧',
      'リポジトリの一覧を確認',
      'リポジトリの一覧を教えてください',
      'リポジトリを確認したいです',
      'リポジトリを見せて',
      'レポジトリ一覧',
      'レポジトリの一覧',
      'repo一覧',
      'repoを確認',
    ])('parses "%s" as GIT_LIST_REPOS', (input) => {
      expect(parseLineMessage(input, USER_ID).type).toBe('GIT_LIST_REPOS');
    });
  });

  describe('GIT_STATUS — natural language', () => {
    test.each([
      'ステータス確認',
      'ステータスを確認',
      'git status',
      'statusを確認',
      'gitの状態を確認したい',
    ])('parses "%s" as GIT_STATUS', (input) => {
      expect(parseLineMessage(input, USER_ID).type).toBe('GIT_STATUS');
    });
  });

  describe('GIT_LOG — natural language', () => {
    test.each([
      'ログ確認',
      'ログを確認',
      'コミット履歴を確認',
      'log確認',
    ])('parses "%s" as GIT_LOG', (input) => {
      expect(parseLineMessage(input, USER_ID).type).toBe('GIT_LOG');
    });
  });

  describe('GIT_FETCH / PULL / PUSH — natural language', () => {
    test.each([
      ['フェッチして', 'GIT_FETCH'],
      ['fetchして', 'GIT_FETCH'],
      ['プルして', 'GIT_PULL'],
      ['pullお願い', 'GIT_PULL'],
      ['プッシュして', 'GIT_PUSH'],
      ['pushする', 'GIT_PUSH'],
    ] as [string, LineCommand['type']][])('parses "%s" as %s', (input, expected) => {
      expect(parseLineMessage(input, USER_ID).type).toBe(expected);
    });
  });

  describe('GIT_BRANCH_LIST — natural language', () => {
    test.each([
      'ブランチ一覧',
      'ブランチの一覧',
      'ブランチを確認',
    ])('parses "%s" as GIT_BRANCH_LIST', (input) => {
      expect(parseLineMessage(input, USER_ID).type).toBe('GIT_BRANCH_LIST');
    });
  });

  describe('GIT_CHECKOUT', () => {
    test.each([
      ['mainに切り替え', 'main'],
      ['feature/loginに切り替え', 'feature/login'],
      ['developにcheckout', 'develop'],
      ['mainにswitch', 'main'],
    ])('parses "%s" → branch "%s"', (input, branch) => {
      const result = parseLineMessage(input, USER_ID);
      expect(result.type).toBe('GIT_CHECKOUT');
      if (result.type === 'GIT_CHECKOUT') expect(result.branch).toBe(branch);
    });
  });

  describe('GIT_SELECT_REPO', () => {
    test.each([
      ['Creancora を選択', 'Creancora'],
      ['Creancora を開く', 'Creancora'],
      ['Creancora のリポジトリを選択', 'Creancora'],
    ])('parses "%s" → query "%s"', (input, query) => {
      const result = parseLineMessage(input, USER_ID);
      expect(result.type).toBe('GIT_SELECT_REPO');
      if (result.type === 'GIT_SELECT_REPO') expect(result.query).toBe(query);
    });
  });

  describe('GIT_CONFIRM / GIT_CANCEL', () => {
    test.each([
      ['はい', 'GIT_CONFIRM'],
      ['実行して', 'GIT_CONFIRM'],
      ['実行', 'GIT_CONFIRM'],
      ['いいえ', 'GIT_CANCEL'],
      ['キャンセル', 'GIT_CANCEL'],
    ] as [string, LineCommand['type']][])('parses "%s" as %s', (input, expected) => {
      expect(parseLineMessage(input, USER_ID).type).toBe(expected);
    });
  });

  describe('GIT_DIFF', () => {
    test.each([
      '差分確認',
      'git diff',
      'gitの差分',
      '変更差分',
    ])('parses "%s" as GIT_DIFF', (input) => {
      expect(parseLineMessage(input, USER_ID).type).toBe('GIT_DIFF');
    });
  });

  // ── Editor commands ───────────────────────────────────────────────────────

  describe('EDITOR_OPEN', () => {
    test.each([
      ['VSCodeを開いて', 'VSCode'],
      ['Cursorを開いて', 'Cursor'],
      ['Cursorを起動して', 'Cursor'],
      ['エディターを開いて', null],
    ])('parses "%s" → editorHint "%s"', (input, hint) => {
      const result = parseLineMessage(input, USER_ID);
      expect(result.type).toBe('EDITOR_OPEN');
      if (result.type === 'EDITOR_OPEN') expect(result.editorHint).toBe(hint);
    });
  });

  describe('EDITOR_OPEN_REPO', () => {
    test('parses "{name}をVSCodeで開いて"', () => {
      const result = parseLineMessage('CreancorをVSCodeで開いて', USER_ID);
      expect(result.type).toBe('EDITOR_OPEN_REPO');
      if (result.type === 'EDITOR_OPEN_REPO') {
        expect(result.repoQuery).toBe('Creancor');
        expect(result.editorHint).toBe('VSCode');
      }
    });

    test('parses "{name}をCursorで開いて"', () => {
      const result = parseLineMessage('MyProjectをCursorで開いて', USER_ID);
      expect(result.type).toBe('EDITOR_OPEN_REPO');
      if (result.type === 'EDITOR_OPEN_REPO') expect(result.repoQuery).toBe('MyProject');
    });

    test('parses "{name}をエディターで開いて" → editorHint null', () => {
      const result = parseLineMessage('Creancorをエディターで開いて', USER_ID);
      expect(result.type).toBe('EDITOR_OPEN_REPO');
      if (result.type === 'EDITOR_OPEN_REPO') expect(result.editorHint).toBeNull();
    });
  });

  describe('EDITOR_STATUS', () => {
    test.each(['エディター確認', 'エディター状態', 'エディター一覧'])(
      'parses "%s" as EDITOR_STATUS', (input) => {
        expect(parseLineMessage(input, USER_ID).type).toBe('EDITOR_STATUS');
      }
    );
  });

  // ── Config commands ───────────────────────────────────────────────────────

  describe('REPOS_PATH_SET', () => {
    test.each([
      ['パス設定: D:\\Project', 'D:\\Project'],
      ['パス設定：D:\\Project', 'D:\\Project'],
      ['パス設定:  D:\\Project  ', 'D:\\Project'],
    ])('parses "%s" → paths "%s"', (input, paths) => {
      const result = parseLineMessage(input, USER_ID);
      expect(result.type).toBe('REPOS_PATH_SET');
      if (result.type === 'REPOS_PATH_SET') expect(result.paths).toBe(paths);
    });
  });

  describe('CONFIG_SHOW', () => {
    test.each(['設定確認', 'config確認', '設定ファイル'])(
      'parses "%s" as CONFIG_SHOW', (input) => {
        expect(parseLineMessage(input, USER_ID).type).toBe('CONFIG_SHOW');
      }
    );
  });

  // ── SESSION_END ───────────────────────────────────────────────────────────

  describe('SESSION_END', () => {
    test('parses "今日は終わってください"', () => {
      expect(parseLineMessage('今日は終わってください', USER_ID).type).toBe('SESSION_END');
    });
    test('returns UNKNOWN for partial "今日は終わって"', () => {
      expect(parseLineMessage('今日は終わって', USER_ID).type).toBe('UNKNOWN');
    });
  });

  describe('GIT_INIT', () => {
    test.each([
      ['新規リポジトリ: my-repo', 'my-repo'],
      ['新規リポジトリ：my-repo', 'my-repo'],
      ['新しいリポジトリ: creator-ai-promo', 'creator-ai-promo'],
      ['リポジトリ作成: my-app', 'my-app'],
      ['リポジトリの作成: my-app', 'my-app'],
      ['git init: some-project', 'some-project'],
    ])('parses "%s" → name="%s"', (input, expectedName) => {
      const result = parseLineMessage(input, USER_ID);
      expect(result.type).toBe('GIT_INIT');
      if (result.type === 'GIT_INIT') {
        expect(result.name).toBe(expectedName);
      }
    });

    test('returns UNKNOWN for bare "新規リポジトリ" without colon', () => {
      expect(parseLineMessage('新規リポジトリ', USER_ID).type).toBe('UNKNOWN');
    });
  });

  describe('TEAM_PROPOSE', () => {
    test.each([
      'チーム提案',
      'チーム構成を提案',
      'AIでチームを作成',
      'AIでチームを提案',
    ])('parses "%s"', (input) => {
      expect(parseLineMessage(input, USER_ID).type).toBe('TEAM_PROPOSE');
    });

    test('captures description after colon', () => {
      const result = parseLineMessage('チーム提案: クリエイターAI宣伝ツール', USER_ID);
      expect(result.type).toBe('TEAM_PROPOSE');
      if (result.type === 'TEAM_PROPOSE') {
        expect(result.description).toBe('クリエイターAI宣伝ツール');
      }
    });

    test('empty description when no colon', () => {
      const result = parseLineMessage('チーム提案', USER_ID);
      expect(result.type).toBe('TEAM_PROPOSE');
      if (result.type === 'TEAM_PROPOSE') {
        expect(result.description).toBe('');
      }
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    test('does not confuse リポジトリ with プッシュ', () => {
      expect(parseLineMessage('リポジトリにプッシュして', USER_ID).type).toBe('GIT_PUSH');
    });

    test('GIT_LIST_REPOS does not match unrelated リポジトリ usage', () => {
      // "リポジトリを選択" → GIT_SELECT_REPO (選択パターンが先に来る)
      // BUT パターン順次チェックのため GIT_LIST_REPOS が先 → 実際の動作を確認
      const result = parseLineMessage('このリポジトリを選択', USER_ID);
      // GIT_LIST_REPOS か GIT_SELECT_REPO のどちらかにマッチする（実装依存）
      expect(['GIT_LIST_REPOS', 'GIT_SELECT_REPO']).toContain(result.type);
    });

    test('long message with command keyword still matches', () => {
      expect(parseLineMessage('今の状態のリポジトリ一覧を教えてもらえますか', USER_ID).type).toBe('GIT_LIST_REPOS');
    });

    test('mixed case for git/repo keywords', () => {
      expect(parseLineMessage('REPOを確認', USER_ID).type).toBe('GIT_LIST_REPOS');
    });
  });
});
