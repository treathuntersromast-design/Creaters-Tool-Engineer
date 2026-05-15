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
  | { type: 'GIT_COMMIT'; message: string | null; userId: string }
  | { type: 'GIT_MERGE'; branch: string; userId: string }
  // editor commands
  | { type: 'EDITOR_OPEN'; editorHint: string | null; userId: string }
  | { type: 'EDITOR_OPEN_REPO'; repoQuery: string; editorHint: string | null; userId: string }
  | { type: 'EDITOR_STATUS'; userId: string }
  // config commands
  | { type: 'REPOS_PATH_SET'; paths: string; userId: string }
  | { type: 'CONFIG_SHOW'; userId: string }
  // repo analysis commands
  | { type: 'REPO_ANALYZE'; query: string; userId: string }
  | { type: 'FILE_LIST'; userId: string }
  | { type: 'FILE_READ'; filePath: string; userId: string }
  // repo creation
  | { type: 'GIT_INIT'; name: string; userId: string }
  // team composition
  | { type: 'TEAM_PROPOSE'; description: string; userId: string }
  // Claude Code integration
  | { type: 'CLAUDE_PLAN'; prompt: string; userId: string }
  // フィードバック・自己改善
  | { type: 'FEEDBACK'; description: string; userId: string }
  // スクリーンショット
  | { type: 'SCREENSHOT'; userId: string }
  // Windows Update
  | { type: 'WU_CHECK'; userId: string }
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
    // リポジトリ一覧 / repo一覧 / レポジトリ一覧（自然文含む）
    regex: /(?:リポジトリ|レポジトリ|repo)[のを]?(?:一覧|確認|を確認|を見|みせて|教えて|を教えて)/i,
    build: (_, userId) => ({ type: 'GIT_LIST_REPOS', userId }),
  },
  {
    // {name}を選択 / {name}を開く / {name}のリポジトリ
    regex: /^\s*(.+?)(?:を選択|を開く|のリポジトリ(?:を選択)?)\s*$/,
    build: (m, userId) => ({ type: 'GIT_SELECT_REPO', query: m[1]!.trim(), userId }),
  },
  {
    regex: /(?:ステータス|git\s*status|status|gitの状態)(?:確認|を確認|みせて|教えて)?/i,
    build: (_, userId) => ({ type: 'GIT_STATUS', userId }),
  },
  {
    regex: /(?:ログ|\blog\b|コミット履歴)(?:確認|を確認|みせて|教えて)?/i,
    build: (_, userId) => ({ type: 'GIT_LOG', userId }),
  },
  {
    regex: /(?:フェッチ|fetch)(?:して|する|お願い)?/i,
    build: (_, userId) => ({ type: 'GIT_FETCH', userId }),
  },
  {
    regex: /(?:プル|pull)(?:して|する|お願い)?/i,
    build: (_, userId) => ({ type: 'GIT_PULL', userId }),
  },
  {
    regex: /(?:プッシュ|push)(?:して|する|お願い)?/i,
    build: (_, userId) => ({ type: 'GIT_PUSH', userId }),
  },
  {
    regex: /ブランチ[のを]?(?:一覧|確認|を確認|みせて|教えて)/i,
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

  // ── 設定 ──
  {
    // "パス設定: D:\Project" / "パス設定：D:\Project"
    regex: new RegExp(`^パス設定${COLON_PATTERN}\\s*(.+)$`),
    build: (m, userId) => ({ type: 'REPOS_PATH_SET', paths: m[1]!.trim(), userId }),
  },
  {
    regex: /^\s*(設定確認|config確認|設定ファイル)\s*$/,
    build: (_, userId) => ({ type: 'CONFIG_SHOW', userId }),
  },

  // ── Git コミット ──
  {
    // "コミット: バグ修正" / "コミットして" / "git commit"
    regex: new RegExp(`^(?:git\\s*commit|コミット)(?:${COLON_PATTERN}\\s*(.+)|して(?:ください)?|する)?\\s*$`, 'i'),
    build: (m, userId) => ({ type: 'GIT_COMMIT', message: m[1]?.trim() ?? null, userId }),
  },

  // ── Git マージ ──
  {
    // "mainをマージして" / "mainにマージ" / "マージ: main"
    regex: new RegExp(`^(?:(.+?)(?:を|に)マージ(?:して(?:ください)?|する)?|マージ${COLON_PATTERN}\\s*(.+))\\s*$`, 'i'),
    build: (m, userId) => ({ type: 'GIT_MERGE', branch: (m[1] ?? m[2] ?? '').trim(), userId }),
  },

  // ── リポジトリ作成 ──
  {
    // "新規リポジトリ: my-repo" / "リポジトリ作成: my-repo" / "新しいリポジトリ: my-repo"
    regex: new RegExp(`^(?:新規リポジトリ|新しいリポジトリ|リポジトリ(?:の)?作成|git\\s*init)${COLON_PATTERN}\\s*(.+)$`, 'i'),
    build: (m, userId) => ({ type: 'GIT_INIT', name: m[1]!.trim(), userId }),
  },

  // ── スクリーンショット ──
  {
    // "スクリーンショット" / "キャプチャ" / "画面を撮って" / "画面キャプチャ" など
    regex: /^\s*(?:スクリーンショット|画面(?:キャプチャ|を?撮って|撮影)|キャプチャ(?:して|を撮って|を送って)?|screenshot)\s*$/i,
    build: (_, userId) => ({ type: 'SCREENSHOT', userId }),
  },

  // ── フィードバック・自己改善 ──
  {
    // "改善: この返答がおかしい" / "フィードバック: ..." / "この会話は想定外" / "この返答は間違い"
    regex: new RegExp(
      `^(?:改善|フィードバック|feedback|FB)${COLON_PATTERN}\\s*(.+)$|` +
      `^(?:この(?:会話|返答|応答)は?(?:想定外|間違い|おかしい|違う|NG)(?:です|だ|でした)?\\s*(?:。|！|!)?(?:\\s*(.+))?)$`,
      'is',
    ),
    build: (m, userId) => ({
      type: 'FEEDBACK',
      description: (m[1] ?? m[2] ?? '').trim() || '直前の返答が想定外でした',
      userId,
    }),
  },

  // ── Windows Update 確認・延長 ──
  {
    // "アップデート確認" / "Windows更新確認" / "アップデート延長" / "更新一時停止" など
    regex: /^\s*(?:Windows\s*)?(?:アップデート|更新|update)(?:の?(?:確認|状況|停止|延長|一時停止|チェック)|確認|延長)?\s*$/i,
    build: (_, userId) => ({ type: 'WU_CHECK', userId }),
  },

  // ── Claude Code プラン実行 ──
  {
    // "プランモード: <prompt>" / "Claudeプラン: <prompt>" / "プランを作って"
    regex: new RegExp(`^(?:プランモード|Claudeプラン|ClaudeCodeプラン|CCプラン)${COLON_PATTERN}\\s*(.+)$`, 'i'),
    build: (m, userId) => ({ type: 'CLAUDE_PLAN', prompt: m[1]!.trim(), userId }),
  },
  {
    // "プランを作って" / "設計プランを作成して" （プロンプト省略形）
    regex: /^\s*(?:(?:設計|アプリの?|開発)?プランを(?:作|生成|作成)(?:して|してください)?|ClaudeCodeを?(?:プランで?)?起動)\s*$/i,
    build: (_, userId) => ({ type: 'CLAUDE_PLAN', prompt: 'このリポジトリのアプリ設計プランを作成してください', userId }),
  },

  // ── チーム構成提案 ──
  {
    // "チーム提案" / "チーム構成を提案" / "AIでチームを作成"
    regex: /^\s*(?:チーム[をの]?(?:提案|構成を?(?:提案|考えて?)|を?作成|メンバーを?提案)|AIで(?:チームを?(?:作成|提案|組んで)))\s*(?:[：:]\s*(.+))?$/,
    build: (m, userId) => ({ type: 'TEAM_PROPOSE', description: m[1]?.trim() ?? '', userId }),
  },
];

export function parseLineMessage(text: string, userId: string): LineCommand {
  for (const { regex, build } of PATTERNS) {
    const match = text.match(regex);
    if (match) return build(match, userId);
  }
  return { type: 'UNKNOWN', raw: text, userId };
}
