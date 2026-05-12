/**
 * Blocks LINE messages that could trick the AI into performing
 * security-critical operations: credential exfiltration, external publishing,
 * destructive commands, or prompt injection.
 *
 * Applied to ALL user-controlled text before it reaches the AI layer:
 * project names, hearing answers, modification requests, and raw messages.
 */

export interface FilterResult {
  blocked: boolean;
  reason?: string;
}

// Each entry: [regex, human-readable reason]
const DANGEROUS_PATTERNS: Array<[RegExp, string]> = [
  // ── Credential / secret exfiltration ─────────────────────────────────────
  [/\.env(?:\b|ファイル)/i,                     '機密ファイル(.env)へのアクセス'],
  [/api[\s_-]?key|APIキー/i,                    'APIキーの取得・送信'],
  [/access[\s_-]?token|アクセストークン/i,       'アクセストークンの取得・送信'],
  [/secret[\s_-]?key|channel[\s_-]?secret/i,   'チャンネルシークレットの取得・送信'],
  [/private[\s_-]?key|id_rsa|\.pem\b/i,        '秘密鍵ファイルへのアクセス'],
  [/パスワード.*送|send.*password/i,             'パスワードの送信'],
  [/認証情報.*送|credentials.*send/i,            '認証情報の外部送信'],
  [/トークン.*外部|token.*external/i,            'トークンの外部送信'],

  // ── External publishing / exfiltration ───────────────────────────────────
  [/外部公開|公開リポジトリ.*push|public.*publish/i, '外部へのコード公開'],
  [/gist.*作成|pastebin|hastebin/i,             '外部貼り付けサービスへの送信'],
  [/コード.*外部.*送|upload.*code.*extern/i,     '外部へのコードアップロード'],
  [/slack.*送信|discord.*送信|email.*send/i,     '外部チャットへの機密送信'],

  // ── Destructive operations ───────────────────────────────────────────────
  [/rm\s+-[rf]{1,2}\s*[\/\\]|rm\s+-[rf]{1,2}\s*\*|rm\s+--(?:recursive|force)/i, '危険な削除コマンド(rm -rf)'],
  [/del\s+\/[fs]/i,                             '危険な削除コマンド(del /f /s)'],
  [/format\s+[a-z]:/i,                          'ドライブフォーマットコマンド'],
  [/git\s+push\s+.*--force|git\s+push\s+.*-f/i, '強制プッシュ(git push --force)'],
  [/git\s+reset\s+--hard/i,                     '破壊的リセット(git reset --hard)'],
  [/drop\s+(?:table|database)/i,                'データベース削除コマンド'],
  [/全(?:ファイル|データ).*削除|delete\s+all/i,  '全データ削除の指示'],

  // ── Shell / code injection ───────────────────────────────────────────────
  [/`[^`]{1,200}`/,                             'バッククォートによるシェル実行'],
  [/\$\([^)]{1,200}\)/,                         '$()によるシェル実行'],
  [/;\s*(?:rm|del|format|kill|shutdown|reboot)/i, 'コマンドチェーンによるシェル実行'],
  [/&&\s*(?:rm|del|format|kill|shutdown)/i,     'コマンドチェーンによるシェル実行'],
  [/\|\s*(?:bash|sh|cmd|powershell)/i,          'シェルへのパイプ実行'],
  [/eval\s*\(/i,                                'eval()によるコード実行'],
  [/exec\s*\(/i,                                'exec()によるコード実行'],

  // ── Prompt injection ─────────────────────────────────────────────────────
  [/ignore\s+(?:previous|above|all)\s+instructions?/i, 'プロンプトインジェクション'],
  [/(?:system|assistant)[\s:]+(?:you\s+are|ignore)/i,  'ロール上書き攻撃'],
  [/以前の指示を無視|全ての指示を無視|システムプロンプトを/,  'プロンプトインジェクション'],
  [/あなたは.*ではなく|役割を変更|キャラクターを変/,         'AIロール変更の指示'],
  [/DAN\b|jailbreak|ジェイルブレイク/i,                   'ジェイルブレイク試行'],

  // ── Sensitive system paths ───────────────────────────────────────────────
  [/\/etc\/(?:passwd|shadow|hosts|sudoers)/i,   'システムファイルへのアクセス'],
  [/%(?:APPDATA|USERPROFILE|SYSTEMROOT)%/i,     'システムディレクトリへのアクセス'],
  [/C:\\Windows\\System32/i,                    'Windowsシステムディレクトリ'],
  [/(?:~\/|\\)\.ssh(?:\/|\\)/,                  'SSHキーへのアクセス（Unix/Windows）'],
];

/**
 * Checks a single text string for dangerous patterns.
 * Returns blocked=true with a reason if matched.
 */
export function filterMessage(text: string): FilterResult {
  for (const [pattern, reason] of DANGEROUS_PATTERNS) {
    if (pattern.test(text)) {
      return { blocked: true, reason };
    }
  }
  return { blocked: false };
}

/**
 * Checks multiple strings (e.g., all fields of a hearing answer).
 * Returns the first match found.
 */
export function filterAny(...texts: (string | null | undefined)[]): FilterResult {
  for (const t of texts) {
    if (!t) continue;
    const result = filterMessage(t);
    if (result.blocked) return result;
  }
  return { blocked: false };
}
