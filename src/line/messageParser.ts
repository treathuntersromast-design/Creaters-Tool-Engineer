export type LineCommand =
  | { type: 'NEW_PROJECT'; name: string; userId: string; force: false }
  | { type: 'NEW_PROJECT_FORCE'; name: string; userId: string; force: true }
  | { type: 'PROGRESS'; userId: string }
  | { type: 'APPROVE'; userId: string }
  | { type: 'MODIFY'; content: string; userId: string }
  | { type: 'STOP'; userId: string }
  | { type: 'RESUME'; userId: string }
  | { type: 'SESSION_END'; userId: string }
  // git commands
  | { type: 'GIT_LIST_REPOS'; userId: string }
  | { type: 'GIT_SELECT_REPO'; query: string; userId: string }
  | { type: 'GIT_STATUS'; userId: string }
  | { type: 'GIT_LOG'; userId: string }
  | { type: 'GIT_FETCH'; userId: string }
  | { type: 'GIT_PULL'; userId: string }
  | { type: 'GIT_PUSH'; userId: string }
  | { type: 'GIT_BRANCH_LIST'; userId: string }
  | { type: 'GIT_CHECKOUT'; branch: string; userId: string }
  | { type: 'GIT_DIFF'; userId: string }
  | { type: 'GIT_CONFIRM'; userId: string }
  | { type: 'GIT_CANCEL'; userId: string }
  // editor commands
  | { type: 'EDITOR_OPEN'; editorHint: string | null; userId: string }
  | { type: 'EDITOR_OPEN_REPO'; repoQuery: string; editorHint: string | null; userId: string }
  | { type: 'EDITOR_STATUS'; userId: string }
  | { type: 'UNKNOWN'; raw: string; userId: string };

const FULL_COLON = '：';
const HALF_COLON = ':';
const COLON_PATTERN = `[${FULL_COLON}${HALF_COLON}]`;

const PATTERNS: Array<{
  regex: RegExp;
  build: (m: RegExpMatchArray, userId: string) => LineCommand;
}> = [
  // ── プロジェクト管理 ──
  {
    regex: new RegExp(`^新規プロジェクト!${COLON_PATTERN}\\s*(.+)$`),
    build: (m, userId) => ({ type: 'NEW_PROJECT_FORCE', name: m[1]!.trim(), userId, force: true }),
  },
  {
    regex: new RegExp(`^新規プロジェクト${COLON_PATTERN}\\s*(.+)$`),
    build: (m, userId) => ({ type: 'NEW_PROJECT', name: m[1]!.trim(), userId, force: false }),
  },
  {
    regex: /^\s*進捗\s*$/,
    build: (_, userId) => ({ type: 'PROGRESS', userId }),
  },
  {
    regex: /^\s*承認\s*$/,
    build: (_, userId) => ({ type: 'APPROVE', userId }),
  },
  {
    regex: new RegExp(`^修正${COLON_PATTERN}\\s*(.+)$`, 's'),
    build: (m, userId) => {
      const content = m[1]!.trim();
      if (!content) return { type: 'UNKNOWN', raw: m[0]!, userId };
      return { type: 'MODIFY', content, userId };
    },
  },
  {
    regex: /^\s*停止\s*$/,
    build: (_, userId) => ({ type: 'STOP', userId }),
  },
  {
    regex: /^\s*再開\s*$/,
    build: (_, userId) => ({ type: 'RESUME', userId }),
  },
  {
    regex: /^\s*今日は終わってください\s*$/,
    build: (_, userId) => ({ type: 'SESSION_END', userId }),
  },

  // ── Git 操作 ──
  {
    // リポジトリ一覧 / repo一覧 / レポジトリ一覧
    regex: /^\s*(リポジトリ一覧|repo一覧|レポジトリ一覧|git一覧|リポジトリ確認)\s*$/i,
    build: (_, userId) => ({ type: 'GIT_LIST_REPOS', userId }),
  },
  {
    // {name}を選択 / {name}を開く / {name}のリポジトリ
    regex: /^\s*(.+?)(?:を選択|を開く|のリポジトリ(?:を選択)?)\s*$/,
    build: (m, userId) => ({ type: 'GIT_SELECT_REPO', query: m[1]!.trim(), userId }),
  },
  {
    regex: /^\s*(ステータス確認|git\s*status|gitステータス|status確認)\s*$/i,
    build: (_, userId) => ({ type: 'GIT_STATUS', userId }),
  },
  {
    regex: /^\s*(ログ確認|git\s*log|コミット履歴|gitログ)\s*$/i,
    build: (_, userId) => ({ type: 'GIT_LOG', userId }),
  },
  {
    regex: /^\s*(フェッチ|fetch(?:して)?|git\s*fetch|gitフェッチ)\s*$/i,
    build: (_, userId) => ({ type: 'GIT_FETCH', userId }),
  },
  {
    regex: /^\s*(プル|pull(?:して)?|git\s*pull|gitプル)\s*$/i,
    build: (_, userId) => ({ type: 'GIT_PULL', userId }),
  },
  {
    regex: /^\s*(プッシュ|push(?:して)?|git\s*push|gitプッシュ)\s*$/i,
    build: (_, userId) => ({ type: 'GIT_PUSH', userId }),
  },
  {
    regex: /^\s*(ブランチ一覧|git\s*branch|ブランチ確認)\s*$/i,
    build: (_, userId) => ({ type: 'GIT_BRANCH_LIST', userId }),
  },
  {
    // {branch}に切り替え / {branch}にcheckout / {branch}にswitch
    regex: /^\s*(.+?)(?:に切り替え|にcheckout|にswitch)\s*$/i,
    build: (m, userId) => ({ type: 'GIT_CHECKOUT', branch: m[1]!.trim(), userId }),
  },
  {
    regex: /^\s*(差分確認|git\s*diff|gitの差分|変更差分)\s*$/i,
    build: (_, userId) => ({ type: 'GIT_DIFF', userId }),
  },
  {
    regex: /^\s*(はい|実行して|実行)\s*$/,
    build: (_, userId) => ({ type: 'GIT_CONFIRM', userId }),
  },
  {
    regex: /^\s*(いいえ|キャンセル)\s*$/,
    build: (_, userId) => ({ type: 'GIT_CANCEL', userId }),
  },

  // ── Editor commands ──
  // "{name}を{Editor}で開いて" → open specific repo in editor
  // Must come before the generic EDITOR_OPEN so the repo name is captured
  {
    regex: /^\s*(.+?)を(VSCode|Cursor|Insiders|エディター)で開いて\s*$/i,
    build: (m, userId) => ({
      type: 'EDITOR_OPEN_REPO',
      repoQuery: m[1]!.trim(),
      editorHint: m[2]!.toLowerCase() === 'エディター' ? null : m[2]!.trim(),
      userId,
    }),
  },
  // "VSCodeを開いて" / "Cursorを起動して" / "エディターを開いて" → just launch
  {
    regex: /^\s*(VSCode|Cursor|Insiders|エディター)(?:を開いて|を起動して|を立ち上げて|起動|を開く)\s*$/i,
    build: (m, userId) => ({
      type: 'EDITOR_OPEN',
      editorHint: m[1]!.toLowerCase() === 'エディター' ? null : m[1]!.trim(),
      userId,
    }),
  },
  // "エディター確認" / "エディター状態"
  {
    regex: /^\s*(エディター確認|エディター状態|エディター一覧)\s*$/,
    build: (_, userId) => ({ type: 'EDITOR_STATUS', userId }),
  },
];

export function parseLineMessage(text: string, userId: string): LineCommand {
  for (const { regex, build } of PATTERNS) {
    const match = text.match(regex);
    if (match) return build(match, userId);
  }
  return { type: 'UNKNOWN', raw: text, userId };
}
