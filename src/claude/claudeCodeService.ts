import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { LineClient } from '../line/lineClient';
import { logger } from '../utils/logger';

const execAsync = promisify(execFile);

const CHUNK_SIZE = 4000;

// Plan mode: read-only tools — generates a plan without modifying anything
const PLAN_TOOLS = 'Read,Glob,Grep,LS';
// Exec mode: file editing allowed; shell restricted to safe local commands only
const EXEC_TOOLS = 'Read,Edit,Write,Glob,Grep,LS';

// タイムアウト: プラン/分析は最大5分、実行（ファイル編集）は最大10分。
const PLAN_TIMEOUT_MS = 300_000; // 5分
const EXEC_TIMEOUT_MS = 600_000; // 10分

const YES_WORDS = new Set(['はい', 'yes', 'ok', 'ｙ', 'y', '実行', '実行して', '実行してください', 'お願い', 'やって']);
const NO_WORDS  = new Set(['いいえ', 'no', 'キャンセル', 'cancel', 'やめて', 'やめる', 'やめます', 'ｎ', 'n']);

export function splitIntoChunks(text: string, maxLen = CHUNK_SIZE): string[] {
  const chunks: string[] = [];
  let i = 0;
  while (i < text.length) {
    chunks.push(text.slice(i, i + maxLen));
    i += maxLen;
  }
  return chunks.length > 0 ? chunks : ['(応答なし)'];
}

interface PendingPlan {
  prompt: string;
  repoPath: string;
}

export class ClaudeCodeService {
  private readonly pendingPlans = new Map<string, PendingPlan>();

  constructor(private readonly lineClient: LineClient) {}

  hasPendingPlan(userId: string): boolean {
    return this.pendingPlans.has(userId);
  }

  private consumePendingPlan(userId: string): PendingPlan | null {
    const plan = this.pendingPlans.get(userId) ?? null;
    this.pendingPlans.delete(userId);
    return plan;
  }

  cancelPendingPlan(userId: string): boolean {
    const had = this.pendingPlans.has(userId);
    this.pendingPlans.delete(userId);
    return had;
  }

  // ── Plan mode: read-only, asks confirmation before execution ──────────────

  async runPlan(
    repoPath: string,
    prompt: string,
    userId: string,
  ): Promise<void> {
    // LINE 経由の実行は、次の4層で防御される:
    //   (a) セッション認証 + OTP による本人確認
    //   (b) commandFilter による入力フィルタ
    //   (c) Bash ツール不許可（push / publish 等のシェル操作は実行不能）
    //   (d) プラン提示 → ユーザーの「はい」確認フロー必須
    // このため、アプリ自身のソースを対象とするプランでも安全に自動実行できる。
    await this.lineClient.sendPush(userId, '🤖 Claude Code でプランを生成中...\n（最大5分かかる場合があります）');

    const text = await this.callClaude(repoPath, prompt, PLAN_TOOLS, userId, { timeoutMs: PLAN_TIMEOUT_MS });
    if (text === null) return; // error already sent

    const chunks = splitIntoChunks(text);

    if (chunks.length === 1) {
      await this.lineClient.sendPush(userId, `📋 Claude Code プラン\n\n${chunks[0]}`);
    } else {
      for (let i = 0; i < chunks.length; i++) {
        await this.lineClient.sendPush(userId, `📋 Claude Code プラン (${i + 1}/${chunks.length})\n\n${chunks[i]}`);
      }
    }

    // Store pending for confirmation
    this.pendingPlans.set(userId, { prompt, repoPath });

    await this.lineClient.sendPush(userId,
      '─────────────────\n' +
      '✅ このプランで実行しますか？\n\n' +
      '・「はい」→ プロンプトをそのまま実行\n' +
      '・「いいえ」→ キャンセル\n' +
      '・修正したいプロンプトをそのまま入力 → そのまま実行\n\n' +
      '（他のコマンドを送るとプランはキャンセルされます）',
    );

    logger.info('Claude Code plan generated, awaiting confirmation', { userId, repoPath });
  }

  // ── Analyze mode: read-only, immediate answer (no confirmation) ───────────

  async runAnalyze(repoPath: string, query: string, userId: string): Promise<string | null> {
    await this.lineClient.sendPush(userId, '🔍 Claude Code でリポジトリを分析中...\n（最大5分かかる場合があります）');

    const prompt = [
      'あなたはこのリポジトリ（カレントディレクトリ）のファイルを直接読むことができます。',
      '以下の質問に日本語で回答してください。',
      'LINE メッセージとして読みやすいよう簡潔に（目安2000文字以内）。',
      '根拠となるファイルパスを明記してください。',
      'ファイルの変更は行わないでください。',
      '',
      query,
    ].join('\n');

    const text = await this.callClaude(repoPath, prompt, PLAN_TOOLS, userId, { timeoutMs: PLAN_TIMEOUT_MS });
    if (text === null) return null; // error already sent

    const chunks = splitIntoChunks(text);

    if (chunks.length === 1) {
      await this.lineClient.sendPush(userId, `🔍 分析結果\n\n${chunks[0]}`);
    } else {
      for (let i = 0; i < chunks.length; i++) {
        await this.lineClient.sendPush(userId, `🔍 分析結果 (${i + 1}/${chunks.length})\n\n${chunks[i]}`);
      }
    }

    logger.info('Claude Code analyze completed', { repoPath, chars: text.length });
    return text;
  }

  // ── Confirmation / rewrite handler ────────────────────────────────────────

  async handleConfirmOrRewrite(content: string, userId: string): Promise<void> {
    const normalised = content.trim().toLowerCase();

    if (NO_WORDS.has(normalised)) {
      this.cancelPendingPlan(userId);
      await this.lineClient.sendPush(userId, '🚫 プランの実行をキャンセルしました。');
      return;
    }

    const pending = this.pendingPlans.get(userId);
    if (!pending) {
      await this.lineClient.sendPush(userId, '確認待ちのプランがありません。');
      return;
    }

    // "はい" → use stored prompt; anything else → treat as rewritten prompt
    const execPrompt = YES_WORDS.has(normalised) ? pending.prompt : content.trim();
    this.pendingPlans.delete(userId);

    if (!YES_WORDS.has(normalised)) {
      await this.lineClient.sendPush(userId, `📝 修正プロンプトで実行します:\n\n${execPrompt}`);
    }

    await this.runExec(pending.repoPath, execPrompt, userId);
  }

  // ── Exec mode: file editing allowed ──────────────────────────────────────

  async runExec(repoPath: string, prompt: string, userId: string): Promise<void> {
    await this.lineClient.sendPush(userId, '⚙️ Claude Code を実行中...\n（最大10分かかる場合があります）');

    const text = await this.callClaude(repoPath, prompt, EXEC_TOOLS, userId, { timeoutMs: EXEC_TIMEOUT_MS });
    if (text === null) return;

    const chunks = splitIntoChunks(text);

    if (chunks.length === 1) {
      await this.lineClient.sendPush(userId, `✅ 実行完了\n\n${chunks[0]}`);
    } else {
      await this.lineClient.sendPush(userId, `✅ 実行完了 (${chunks.length}件に分割)`);
      for (let i = 0; i < chunks.length; i++) {
        await this.lineClient.sendPush(userId, `📄 結果 (${i + 1}/${chunks.length})\n\n${chunks[i]}`);
      }
    }

    // アプリ自身のソースを変更した場合はビルド + 再起動が必要な旨を通知する。
    if (path.resolve(repoPath) === path.resolve(process.cwd())) {
      await this.lineClient.sendPush(userId,
        '⚠️ アプリ自身のコードを変更しました。反映には npm run build と再起動が必要です（手動で実施してください）。',
      );
    }

    logger.info('Claude Code exec completed', { repoPath, chars: text.length });
  }

  // ── Internal: shared CLI invocation ──────────────────────────────────────

  private async callClaude(
    repoPath: string,
    prompt: string,
    allowedTools: string,
    userId: string,
    opts?: { timeoutMs?: number },
  ): Promise<string | null> {
    const timeoutMs = opts?.timeoutMs ?? PLAN_TIMEOUT_MS;
    // On Windows npm global installs create claude.cmd; execFile resolves it without shell:true
    const cmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    try {
      const result = await execAsync(
        cmd,
        ['-p', prompt, '--allowedTools', allowedTools, '--output-format', 'text'],
        {
          cwd: repoPath,
          timeout: timeoutMs,
          encoding: 'utf-8',
          maxBuffer: 8 * 1024 * 1024,
        },
      );
      return result.stdout.trim() || '(応答なし)';
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string; code?: string; killed?: boolean; signal?: string };

      if (e.code === 'ENOENT') {
        await this.lineClient.sendPush(userId,
          '❌ Claude Code がインストールされていません。\n\n' +
          'インストール方法:\n' +
          '  npm install -g @anthropic-ai/claude-code\n\n' +
          'インストール後に再度お試しください。',
        );
      } else if (e.killed === true || e.signal === 'SIGTERM') {
        // execFile の timeout 超過時は killed=true / signal='SIGTERM' で reject される。
        await this.lineClient.sendPush(userId,
          '⏱️ 制限時間内に完了しませんでした。指示を分割するか対象を絞って再実行してください。',
        );
        logger.warn('claudeCodeService callClaude timed out', { repoPath, timeoutMs });
      } else {
        const detail = e.stderr?.trim() || e.message || '不明なエラー';
        await this.lineClient.sendPush(userId, `❌ Claude Code の実行に失敗しました。\n\n${detail}`);
        logger.error('claudeCodeService callClaude failed', { err: detail, repoPath });
      }
      return null;
    }
  }
}
