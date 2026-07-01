import { execFile } from 'child_process';
import { promisify } from 'util';
import { LineClient } from '../line/lineClient';
import { logger } from '../utils/logger';

const execAsync = promisify(execFile);

const CHUNK_SIZE = 4000;

// Plan mode: read-only tools — generates a plan without modifying anything
const PLAN_TOOLS = 'Read,Glob,Grep,LS';
// Exec mode: file editing allowed; shell restricted to safe local commands only
const EXEC_TOOLS = 'Read,Edit,Write,Glob,Grep,LS';

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
    options?: { allowExec?: boolean },
  ): Promise<void> {
    const allowExec = options?.allowExec ?? true;
    await this.lineClient.sendPush(userId, '🤖 Claude Code でプランを生成中...\n（最大2分かかる場合があります）');

    const text = await this.callClaude(repoPath, prompt, PLAN_TOOLS, userId);
    if (text === null) return; // error already sent

    const chunks = splitIntoChunks(text);

    if (chunks.length === 1) {
      await this.lineClient.sendPush(userId, `📋 Claude Code プラン\n\n${chunks[0]}`);
    } else {
      for (let i = 0; i < chunks.length; i++) {
        await this.lineClient.sendPush(userId, `📋 Claude Code プラン (${i + 1}/${chunks.length})\n\n${chunks[i]}`);
      }
    }

    // allowExec=false のプランは LINE 経由での自動実行を許可しない。
    // 特にアプリ自身のソースを対象とする改善プラン（feedback）で、
    // LINE 入力からセキュリティ制御コードを書き換えられるのを防ぐため。
    if (!allowExec) {
      await this.lineClient.sendPush(userId,
        '─────────────────\n' +
        '⚠️ この改善プランはアプリ自身のコードに関わるため、LINE からは自動実行されません。\n' +
        '内容を確認のうえ、PC 側で担当者が適用してください。',
      );
      logger.info('Claude Code read-only plan generated (exec disabled)', { userId, repoPath });
      return;
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
    await this.lineClient.sendPush(userId, '⚙️ Claude Code を実行中...\n（最大2分かかる場合があります）');

    const text = await this.callClaude(repoPath, prompt, EXEC_TOOLS, userId);
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

    logger.info('Claude Code exec completed', { repoPath, chars: text.length });
  }

  // ── Internal: shared CLI invocation ──────────────────────────────────────

  private async callClaude(
    repoPath: string,
    prompt: string,
    allowedTools: string,
    userId: string,
  ): Promise<string | null> {
    // On Windows npm global installs create claude.cmd; execFile resolves it without shell:true
    const cmd = process.platform === 'win32' ? 'claude.cmd' : 'claude';
    try {
      const result = await execAsync(
        cmd,
        ['-p', prompt, '--allowedTools', allowedTools, '--output-format', 'text'],
        {
          cwd: repoPath,
          timeout: 120_000,
          encoding: 'utf-8',
          maxBuffer: 2 * 1024 * 1024,
        },
      );
      return result.stdout.trim() || '(応答なし)';
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string; code?: string };

      if (e.code === 'ENOENT') {
        await this.lineClient.sendPush(userId,
          '❌ Claude Code がインストールされていません。\n\n' +
          'インストール方法:\n' +
          '  npm install -g @anthropic-ai/claude-code\n\n' +
          'インストール後に再度お試しください。',
        );
      } else {
        const detail = e.stderr?.trim() || e.message || '不明なエラー';
        await this.lineClient.sendPush(userId, `❌ Claude Code の実行に失敗しました。\n\n${detail}`);
        logger.error('claudeCodeService callClaude failed', { err: detail, repoPath });
      }
      return null;
    }
  }
}
