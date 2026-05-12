# Creaters Tool Engineer

LINE Messaging API と Claude AI を組み合わせた、ローカル AI 開発チームオーケストレーターです。  
Windows PC 上でデスクトップアプリ（EXE）として動作し、指定した LINE アカウントとの会話を通じてソフトウェア開発を自動進行します。

---

## 動作イメージ

```
[LINE ユーザー] ──メッセージ──▶ [ngrok] ──Webhook──▶ [Express サーバー]
                                                              │
                                                    AI エージェントが自動実行
                                                    (要件定義 → 設計 → 実装 → テスト → レビュー)
                                                              │
[LINE ユーザー] ◀──進捗通知・完了報告──────────────────────────┘

[対応 PC の Electron GUI]
  ├── LINE アカウント選択（過去にメッセージをくれたアカウント一覧）
  ├── OTP 認証（6 桁コードを LINE 送信 → 10 分以内に返信）
  └── セッション停止ボタン
```

---

## 必要環境

| 項目 | 要件 |
|------|------|
| OS | Windows 10 / 11（x64） |
| Node.js | v18 以上（起動時に自動インストール可） |
| ngrok | アカウント登録 + 固定ドメイン取得済み |
| LINE Developers | Messaging API チャネル作成済み |
| Anthropic API | Claude API キー（任意・なければモック動作） |

---

## セットアップ手順

### 1. LINE Developers の設定

1. [LINE Developers コンソール](https://developers.line.biz/) でプロバイダー・チャネルを作成
2. **Messaging API** チャネルを選択し、以下を控える
   - チャネルシークレット
   - チャネルアクセストークン（長期）
3. Webhook URL は後で設定（ngrok セットアップ後）

### 2. ngrok の設定

1. [ngrok](https://ngrok.com/) にサインアップしてプランを選択
2. 固定ドメインを取得（例: `your-name.ngrok-free.app`）
3. 認証トークンをローカルに設定
   ```powershell
   ngrok config add-authtoken <your-authtoken>
   ```

### 3. リポジトリのクローンとビルド

```powershell
git clone https://github.com/RomanticistStrokers/Creaters-Tool-Engineer.git
cd Creaters-Tool-Engineer
npm install
npm run electron:build
```

ビルド成功後、以下に EXE が生成されます：
```
release\Creaters Tool Engineer-win32-x64\Creaters Tool Engineer.exe
```

### 4. .env ファイルの作成

EXE と同じフォルダに `.env` を作成します（`.env.example` をコピーして編集）：

```powershell
copy .env.example "release\Creaters Tool Engineer-win32-x64\.env"
```

`.env` の内容を編集：

```env
# LINE Messaging API
LINE_CHANNEL_SECRET=ここにチャネルシークレット
LINE_CHANNEL_ACCESS_TOKEN=ここにチャネルアクセストークン

# ngrok（固定ドメインがあれば自動起動）
NGROK_DOMAIN=your-name.ngrok-free.app

# Claude API（任意）
ANTHROPIC_API_KEY=sk-ant-api03-...

# サーバー設定
PORT=3000
HOST=0.0.0.0

# ログレベル
LOG_LEVEL=info
NODE_ENV=production
```

### 5. Webhook URL の設定

1. EXE を起動してサーバーを立ち上げる
2. ngrok が起動したら、以下の URL を LINE Developers コンソールの Webhook URL に設定：
   ```
   https://your-name.ngrok-free.app/webhook
   ```
3. 「検証」ボタンで疎通確認

---

## 使い方

### EXE の起動

`release\Creaters Tool Engineer-win32-x64\` フォルダ内の EXE をダブルクリックします。

> **Node.js が未インストールの場合**  
> 自動インストールのダイアログが表示されます。  
> 「インストール（winget）」を選ぶと自動でインストールされます。  
> 完了後、アプリを再起動してください。

### セッションの開始

1. ドロップダウンから LINE アカウントを選択（過去にメッセージを送ってきたアカウント一覧）
2. 「認証して起動」ボタンをクリック
3. 選択した LINE アカウントに 6 桁の OTP が送信される
4. LINE アプリで受け取った OTP を 10 分以内に返信
5. 認証成功でステータスが「稼働中」に変わる

### セッション中の操作（LINE から）

| コマンド | 動作 |
|---------|------|
| `新規プロジェクト: <名前>` | プロジェクトを新規作成してヒアリング開始 |
| `新規プロジェクト!: <名前>` | 既存プロジェクトを停止して強制的に新規作成 |
| ヒアリング回答（番号付き） | 要件ヒアリングの回答 |
| `承認` | レビュー完了・プロジェクト完成 |
| `修正: <内容>` | 完成後の追加修正依頼 |
| `進捗` | 現在の状態・生成ファイル一覧を表示 |
| `停止` | 処理を一時停止 |
| `再開` | 停止中のプロジェクトを再開 |
| `今日は終わってください` | セッションを終了 |

### セッションの終了

- LINE で「今日は終わってください」を送信
- またはアプリの「セッションを停止する」ボタンをクリック

---

## 生成されるファイル構成

プロジェクトごとに `workspace/<project-slug>/` 以下にファイルが生成されます：

```
workspace/
  my-project-20240512-abc123/
    docs/
      requirements.md          # 要件定義書
      basic-design.md          # 基本設計書
      detailed-design.md       # 詳細設計書
      revisions/
        revision-1.md          # 修正依頼内容（修正時）
    src/
      index.ts
      app.ts
    tests/
      sample.test.ts
    logs/
      test-result.md
    team.json                  # エージェント構成
    project-state.json         # プロジェクト状態
```

---

## 開発者向け

### 開発環境での起動

```powershell
# バックエンドのみ起動（Webhook テスト用）
npm run dev

# Electron アプリとして起動（GUI + サーバー同時起動）
npm run electron:dev
```

> **注意**: VS Code などの Electron ベースのエディタを使用している場合、  
> `ELECTRON_RUN_AS_NODE=1` という環境変数が設定されていることがあります。  
> `npm run electron:dev` はこの変数を自動で無効化して起動します。

### テスト実行

```powershell
npm test               # 全テスト実行
npm run typecheck      # 型チェックのみ
```

### ディレクトリ構成

```
Creaters-Tool-Engineer/
  src/
    agents/        # AI エージェント（Leader / Requirement / Design / Implementation / Test / Review）
    core/          # ビジネスロジック（ProjectService / WorkflowRunner / SessionService）
    db/            # SQLite スキーマ・マイグレーション・リポジトリ
    documents/     # ドキュメント生成テンプレート
    hearing/       # ヒアリング質問・回答パーサー
    line/          # LINE Webhook・メッセージパーサー・管理 API
    utils/         # ロガー・ID 生成・パスサニタイズ
  electron/
    main.ts        # Electron メインプロセス
    preload.ts     # contextBridge
    renderer/      # 管理 GUI（HTML）
  scripts/
    launch-electron.js  # ELECTRON_RUN_AS_NODE 回避ランチャー
  tests/           # Jest テストスイート
```

### EXE のビルド

```powershell
npm run electron:build
```

出力先: `release\Creaters Tool Engineer-win32-x64\`

配布時は以下をまとめて渡してください：
- `release\Creaters Tool Engineer-win32-x64\` フォルダ全体
- `.env` ファイル（フォルダ内に配置）

### プロセス再起動時の注意

アプリを再起動すると、起動から 1 時間以上経過した実行中ワークフローは `FAILED` 状態に自動更新されます。  
「進捗」コマンドで状態を確認後、必要に応じて「再開」または「修正」コマンドで続行してください。

---

## ライセンス

MIT
