# Security Checklist

_Verified: 2026-05-12_

## LINE Webhook

- [x] `/webhook` のみ `express.raw({ type: 'application/json' })` を使用している
- [x] `express.json()` は `/webhook` に適用されていない（`/admin` のみ）
- [x] rawBody を保存してから署名検証している
- [x] 署名検証が JSON.parse より先に実行される（H-01 修正済み）
- [x] JSON.parse 失敗時に 400 を返す（H-01 修正済み）
- [x] HMAC-SHA256 + `LINE_CHANNEL_SECRET` で検証している
- [x] `crypto.timingSafeEqual` を使っている
- [x] `timingSafeEqual` の前に Buffer 長チェックをしている
- [x] 署名ヘッダーがない場合に 401 を返す
- [x] 不正署名の場合に処理が継続しない
- [x] 署名検証失敗時のログに secret を出していない

## OTP / セッション認証

- [x] OTP 生成に `crypto.randomInt(100000, 1000000)` を使用（非 `Math.random`）
- [x] OTP 比較に `crypto.timingSafeEqual` を使用（M-01 修正済み）
- [x] OTP に 10 分の有効期限がある
- [x] 期限切れ OTP は自動キャンセルされる
- [x] Admin API は `localhostOnly` ミドルウェアで保護されている

## Secrets（秘密情報）

- [x] `.env` が `.gitignore` に含まれている
- [x] `.env.example` に本物の値が入っていない（`your_xxx_here` プレースホルダー使用）
- [x] `LINE_CHANNEL_SECRET` が非テスト時に必須になっている
- [x] `LINE_CHANNEL_ACCESS_TOKEN` が非テスト時に必須になっている
- [x] `NODE_ENV=test` のみテスト用デフォルト (`test-secret`, `test-token`) が使われる
- [x] `sanitizeLogObject` が `channelAccessToken`, `channelSecret`, `replyToken`, `authorization`, `x-line-signature`, `LINE_CHANNEL_*` をマスクする
- [x] `sanitizeLogObject` がネストされたオブジェクトにも再帰的に適用される
- [x] `userId` がログで末尾 4 文字のみに短縮される
- [x] Winston のすべての Transport に `sanitizeFormat` が適用されている
- [x] エラーログに生の `req.headers` や `process.env` を渡していない

## Filesystem（ファイルシステム）

- [x] `WorkspaceService.writeFile` が `safeWorkspacePath` を経由している
- [x] `WorkspaceService.readFile` が `safeWorkspacePath` を経由している
- [x] `WORKSPACE_ROOT` 外に書けない（`path.resolve` + `path.relative` による検証）
- [x] 絶対パスを拒否する
- [x] `../` によるパストラバーサルを拒否する
- [x] Windows 形式の `..\` トラバーサルを拒否する
- [x] プロジェクト slug が `[a-z0-9\-_]` のみで構成される（危険文字を除去）
- [x] Windows 予約名（CON, PRN, AUX, NUL, COM1〜9, LPT1〜9）を回避している
- [x] `projects.slug` に UNIQUE 制約がある
- [x] 同名プロジェクトでも timestamp + randomId でスラグが一意になる

## Command Execution（コマンド実行）

- [x] `child_process` はホワイトリスト用途のみ（gitService, repositoryDiscovery, editorService）
- [x] `gitService` は `execFile`（シェル不使用）のみ — args は配列渡し
- [x] `repositoryDiscovery` は `execFileSync` のみ — args は全てハードコード
- [x] `editorService` は `execFile`（コマンド探索）と `spawn`（エディタ起動）のみ — 引数はホワイトリスト
- [x] `eval` / `new Function` を使っていない
- [x] ユーザー入力からコマンドを生成していない
- [x] `MockCodeExecutor` はファイル生成のみ（`child_process` 不使用）
- [x] npm スクリプトをアプリ本体から起動していない

## Git Branch Validation

- [x] `SAFE_BRANCH_RE` でブランチ名を英数字・ハイフン・アンダースコア・スラッシュ・ドットに制限
- [x] `-` で始まるブランチ名（フラグインジェクション）を拒否
- [x] `..` を含むブランチ名（パストラバーサル）を拒否（M-04 修正済み）
- [x] シェルメタ文字（`;`, `&&`, `|` 等）は `SAFE_BRANCH_RE` で除去済み
- [x] git remote URL の認証情報を LINE 送信前に除去（M-03 修正済み）

## Database（データベース）

- [x] `better-sqlite3` の `prepare` + バインド（`?` プレースホルダー）を使用している
- [x] ユーザー入力を SQL 文字列連結していない
- [x] `db.exec` はマイグレーション SQL（ハードコード）のみに使用
- [x] `db.pragma('user_version = N')` の N は整数定数（注入不可）
- [x] `webhook_events.lineWebhookEventId` に `UNIQUE` 制約がある
- [x] `INSERT OR IGNORE` で重複挿入が例外を発生させない
- [x] Webhook 再送で二重処理されない（`isDuplicate` フラグで制御）
- [x] プロジェクト完了・失敗時に `isActive = 0` になる
- [x] `NEW_PROJECT_FORCE` で旧 active が `isActive = 0` になる
- [x] 同一ユーザーで active プロジェクトが複数残らない

## Workflow Safety（ワークフロー安全性）

- [x] `WorkflowRunner` にメモリロック（`Set<string>`）がある
- [x] `WorkflowRunner` に DB の RUNNING チェックがある
- [x] 起動時に 1 時間超過の RUNNING を FAILED にクリーンアップする
- [x] `startPipeline` の Promise に必ず `.catch()` がある
- [x] `.catch()` 内の LINE 送信失敗を `.catch(() => {})` で飲み込み unhandled rejection にしない
- [x] `.finally()` でメモリロックを必ず解放する
- [x] ワークフロー失敗時に `projects.status = 'FAILED'` + `isActive = 0` になる
- [x] 失敗エラーが `workflow_runs.error` と `projects.lastError` に保存される
- [x] `sanitizeError` でエラーを 500 文字に制限してから保存する
- [x] STOPPED プロジェクトのパイプラインがフェーズ開始前に停止する

## Input Validation（入力バリデーション）

- [x] LINE メッセージに 2000 文字の上限がある（M-02 修正済み）
- [x] テキスト以外の LINE メッセージを拒否する
- [x] group/room イベントを個別チャット案内で終了する
- [x] `修正:` の空文字は `UNKNOWN` として扱われる
- [x] HEARING 状態のプロジェクトがない場合に HEARING_REPLY を拒否する
- [x] `sessionService.verifyOtp` で userId 一致チェックがある

## Security Filter（コマンドフィルター）

- [x] `.env` ファイルへのアクセスをブロック
- [x] API キー・アクセストークン・チャンネルシークレット取得をブロック
- [x] SSH 秘密鍵アクセスをブロック（Unix `~/.ssh/` と Windows `\.ssh\` 両対応）
- [x] 外部公開・外部チャット送信をブロック
- [x] `rm -rf`, `rm --recursive`, `del /f /s` 等の破壊的操作をブロック
- [x] `git push --force`, `git reset --hard` をブロック
- [x] バッククォート・`$()` シェル実行をブロック
- [x] `eval()`, `exec()` コード実行をブロック
- [x] "ignore previous instructions" 系プロンプトインジェクションをブロック
- [x] DAN・ジェイルブレイク試行をブロック
- [x] `/etc/passwd`, `C:\Windows\System32` 等のシステムパスへのアクセスをブロック

## Logging（ログ）

- [x] LINE ユーザー向けメッセージにスタックトレースが出ない
- [x] サーバーエラーは "Internal Server Error" のみを返す（詳細は非公開）
- [x] ワークスペースファイルへのログ書き込みなし（Winston Console トランスポートのみ）
- [x] ログファイルの場所（`./logs/`）は `.gitignore` 済み
