import { mkdirSync, existsSync } from 'fs';
import * as nodePath from 'path';
import { GitService } from './gitService';
import { GitSessionManager } from './gitSessionManager';
import { discoverRepositories, RepoInfo } from './repositoryDiscovery';
import { LineClient } from '../line/lineClient';
import { logger } from '../utils/logger';

// LINE message body limit is 5000 chars; leave room for prefix text
const OUTPUT_MAX_CHARS = 3800;

// Strip embedded credentials from git remote URLs (https://user:token@host → https://host)
function sanitizeRemoteUrl(url: string): string {
  return url.replace(/:\/\/[^@]+@/, '://');
}

// Apply sanitizeRemoteUrl to every line of git output to prevent credential leaks via LINE
function sanitizeGitOutput(text: string): string {
  return text.split('\n').map(sanitizeRemoteUrl).join('\n');
}

// Allow only safe branch name characters (no shell metacharacters or git flags)
const SAFE_BRANCH_RE = /^[a-zA-Z0-9._\-\/]+$/;

function truncate(text: string, prefix = ''): string {
  const full = prefix ? `${prefix}\n\n${text}` : text;
  if (full.length <= OUTPUT_MAX_CHARS) return full;
  const trimmed = text.slice(0, OUTPUT_MAX_CHARS - prefix.length - 20);
  return `${prefix}\n\n${trimmed}\n...(省略)`;
}

export class GitCommandService {
  private repoCache: RepoInfo[] | null = null;
  private repoCacheAt = 0;
  private readonly CACHE_TTL = 60_000;

  constructor(
    private readonly gitService: GitService,
    private readonly gitSession: GitSessionManager,
    private readonly lineClient: LineClient,
  ) {}

  async runCommand(repoPath: string, args: string[]): Promise<{ ok: boolean; stdout: string; stderr: string }> {
    return this.gitService.run(repoPath, args);
  }

  getSessionState(): { selectedRepo: string | null; pendingAction: string | null } {
    const repo = this.gitSession.getRepo();
    const pending = this.gitSession.getPending();
    return {
      selectedRepo: repo ? `${repo.name} (${repo.path})` : null,
      pendingAction: pending ? `${pending.description}（確認待ち）` : null,
    };
  }

  private getRepos(): RepoInfo[] {
    if (this.repoCache && Date.now() - this.repoCacheAt < this.CACHE_TTL) {
      return this.repoCache;
    }
    this.repoCache = discoverRepositories();
    this.repoCacheAt = Date.now();
    return this.repoCache;
  }

  invalidateCache(): void {
    this.repoCache = null;
  }

  async handleInit(name: string, userId: string): Promise<void> {
    const reposPaths = process.env['GIT_REPOS_PATHS'] ?? '';
    const reposRoot = reposPaths.split(';')[0]?.trim();

    if (!reposRoot) {
      await this.lineClient.sendPush(userId,
        '⚠️ リポジトリの作成先パスが設定されていません。\n' +
        '「パス設定: D:\\Project」で作成先を設定してください。',
      );
      return;
    }

    if (!/^[a-zA-Z0-9._\-]+$/.test(name)) {
      await this.lineClient.sendPush(userId,
        `❌ 無効なリポジトリ名です: ${name}\n` +
        `英数字・ハイフン・アンダースコア・ドットのみ使用できます。`,
      );
      return;
    }

    const repoPath = nodePath.join(reposRoot, name);

    if (existsSync(repoPath)) {
      await this.lineClient.sendPush(userId,
        `❌ 既に存在します: ${name}\nパス: ${repoPath}`,
      );
      return;
    }

    try {
      mkdirSync(repoPath, { recursive: true });
    } catch {
      await this.lineClient.sendPush(userId, '❌ ディレクトリの作成に失敗しました。');
      return;
    }

    const result = await this.gitService.init(repoPath);
    if (result.ok) {
      this.gitSession.selectRepo(repoPath);
      this.invalidateCache();
      await this.lineClient.sendPush(userId,
        `✅ リポジトリを作成しました！\n\n` +
        `📁 ${name}\n` +
        `パス: ${repoPath}\n\n` +
        `自動的に選択しました。`,
      );
      logger.info('Git repo initialized', { name, path: repoPath });
    } else {
      await this.lineClient.sendPush(userId, `❌ git init に失敗しました。\n${result.stderr}`);
    }
  }

  async handleListRepos(userId: string): Promise<void> {
    const repos = this.getRepos();
    if (repos.length === 0) {
      await this.lineClient.sendPush(userId,
        '📂 リポジトリが見つかりませんでした。\n' +
        'Documents/GitHub または Documents/git フォルダにリポジトリを置くか、\n' +
        '環境変数 GIT_REPOS_PATHS にパスを設定してください。',
      );
      return;
    }
    const current = this.gitSession.getRepo();
    const lines = ['📂 利用可能なリポジトリ一覧:', ''];
    repos.forEach((r, i) => {
      const selected = current?.path === r.path ? ' ← 選択中' : '';
      const branch = r.currentBranch ? ` [${r.currentBranch}]` : '';
      lines.push(`${i + 1}. ${r.name}${branch}${selected}`);
    });
    lines.push('', '操作: 「{名前}を選択」で切り替え');
    await this.lineClient.sendPush(userId, lines.join('\n'));
  }

  async handleSelectRepo(query: string, userId: string): Promise<void> {
    const repos = this.getRepos();
    const q = query.toLowerCase();
    const found = repos.find(
      (r) => r.name.toLowerCase() === q || r.name.toLowerCase().includes(q),
    );
    if (!found) {
      await this.lineClient.sendPush(userId,
        `❌ 「${query}」に一致するリポジトリが見つかりませんでした。\n「リポジトリ一覧」で確認してください。`,
      );
      return;
    }
    this.gitSession.selectRepo(found.path);
    await this.lineClient.sendPush(userId,
      `✅ リポジトリを選択しました。\n` +
      `📁 ${found.name}\n` +
      `ブランチ: ${found.currentBranch ?? '不明'}\n` +
      (found.remoteUrl ? `Remote: ${sanitizeRemoteUrl(found.remoteUrl)}` : ''),
    );
    logger.info('Git repo selected', { repo: found.name, path: found.path });
  }

  async handleStatus(userId: string): Promise<void> {
    const repo = await this.requireRepo(userId);
    if (!repo) return;
    const result = await this.gitService.status(repo.path);
    const out = sanitizeGitOutput(result.stdout || result.stderr || '変更なし (clean)');
    await this.lineClient.sendPush(userId, truncate(out, `📊 git status [${repo.name}]`));
  }

  async handleLog(userId: string): Promise<void> {
    const repo = await this.requireRepo(userId);
    if (!repo) return;
    const result = await this.gitService.log(repo.path);
    const out = sanitizeGitOutput(result.ok ? (result.stdout || '履歴なし') : `エラー: ${result.stderr}`);
    await this.lineClient.sendPush(userId, truncate(out, `📜 コミット履歴 [${repo.name}]`));
  }

  async handleFetch(userId: string): Promise<void> {
    const repo = await this.requireRepo(userId);
    if (!repo) return;
    await this.lineClient.sendPush(userId, `⚙️ フェッチ中... [${repo.name}]`);
    const result = await this.gitService.fetch(repo.path);
    const fetchStdout = sanitizeGitOutput(result.stdout);
    const fetchStderr = sanitizeGitOutput(result.stderr);
    const out = fetchStdout || fetchStderr || 'Already up to date.';
    if (result.ok) {
      await this.lineClient.sendPush(userId, truncate(out, `✅ フェッチ完了 [${repo.name}]`));
    } else {
      await this.lineClient.sendPush(userId, truncate(fetchStderr, `❌ フェッチ失敗 [${repo.name}]`));
    }
  }

  async handlePull(userId: string): Promise<void> {
    const repo = await this.requireRepo(userId);
    if (!repo) return;
    await this.lineClient.sendPush(userId, `⚙️ プル中... [${repo.name}]`);
    const result = await this.gitService.pull(repo.path);
    const pullStdout = sanitizeGitOutput(result.stdout);
    const pullStderr = sanitizeGitOutput(result.stderr);
    const out = pullStdout || pullStderr || '完了';
    if (result.ok) {
      await this.lineClient.sendPush(userId, truncate(out, `✅ プル完了 [${repo.name}]`));
    } else {
      await this.lineClient.sendPush(userId, truncate(pullStderr, `❌ プル失敗 [${repo.name}]`));
    }
  }

  async handlePush(userId: string): Promise<void> {
    const repo = await this.requireRepo(userId);
    if (!repo) return;

    const branchResult = await this.gitService.run(repo.path, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = branchResult.ok ? sanitizeGitOutput(branchResult.stdout) : '(不明)';

    await this.lineClient.sendPush(userId, `⚙️ プッシュ中... [${repo.name}] ${branch}`);
    const result = await this.gitService.push(repo.path);
    const out = sanitizeGitOutput(result.stdout || result.stderr || '完了');
    if (result.ok) {
      await this.lineClient.sendPush(userId, truncate(out, `✅ プッシュ完了 [${repo.name}] → ${branch}`));
    } else {
      await this.lineClient.sendPush(userId, truncate(sanitizeGitOutput(result.stderr), `❌ プッシュ失敗 [${repo.name}]`));
    }
    logger.info('Git push executed', { repo: repo.name, branch, ok: result.ok });
  }

  async handleCommit(userId: string, userMessage: string | null): Promise<void> {
    const repo = await this.requireRepo(userId);
    if (!repo) return;

    // ステージング
    const addResult = await this.gitService.addAll(repo.path);
    if (!addResult.ok) {
      await this.lineClient.sendPush(userId, `❌ git add に失敗しました。\n${sanitizeGitOutput(addResult.stderr)}`);
      return;
    }

    // ステージ後の差分確認（コミット対象がなければ終了）
    const statResult = await this.gitService.diffCachedStat(repo.path);
    if (!statResult.ok || !statResult.stdout.trim()) {
      await this.lineClient.sendPush(userId, 'ℹ️ コミットする変更がありません。');
      return;
    }

    // コミットメッセージ生成
    const today = new Date();
    const datePart = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('');

    let summary: string;
    if (userMessage && userMessage.trim()) {
      summary = userMessage.trim();
    } else {
      // stat 最終行から "N files changed" を取得して概要生成
      const lines = statResult.stdout.trim().split('\n');
      const lastLine = lines[lines.length - 1] ?? '';
      const changedMatch = lastLine.match(/(\d+) files? changed/);
      const insertMatch  = lastLine.match(/(\d+) insertion/);
      const deleteMatch  = lastLine.match(/(\d+) deletion/);
      const fileCount = changedMatch?.[1] ?? '?';
      const hasBoth = insertMatch && deleteMatch;
      const hasInsert = !!insertMatch;
      summary = hasBoth
        ? `${fileCount}ファイル変更・追加・削除`
        : hasInsert
          ? `${fileCount}ファイル追加・変更`
          : `${fileCount}ファイル変更`;
    }

    const message = `${datePart}_${summary}`;
    const commitResult = await this.gitService.commit(repo.path, message);

    if (commitResult.ok) {
      const out = sanitizeGitOutput(commitResult.stdout || commitResult.stderr || '完了');
      await this.lineClient.sendPush(userId, truncate(out, `✅ コミット完了 [${repo.name}]\n📝 ${message}`));
    } else {
      await this.lineClient.sendPush(userId, truncate(sanitizeGitOutput(commitResult.stderr), `❌ コミット失敗 [${repo.name}]`));
    }
    logger.info('Git commit executed', { repo: repo.name, message, ok: commitResult.ok });
  }

  async handleMerge(branch: string, userId: string): Promise<void> {
    const repo = await this.requireRepo(userId);
    if (!repo) return;

    if (!SAFE_BRANCH_RE.test(branch) || branch.startsWith('-') || branch.includes('..')) {
      await this.lineClient.sendPush(userId,
        `❌ 無効なブランチ名です: ${branch}\n英数字・ハイフン・アンダースコア・スラッシュのみ使用できます。`,
      );
      return;
    }

    await this.lineClient.sendPush(userId, `⚙️ ${branch} をマージ中... [${repo.name}]`);
    const result = await this.gitService.merge(repo.path, branch);
    const out = sanitizeGitOutput(result.stdout || result.stderr || '完了');
    if (result.ok) {
      await this.lineClient.sendPush(userId, truncate(out, `✅ マージ完了 [${repo.name}] ← ${branch}`));
    } else {
      await this.lineClient.sendPush(userId, truncate(sanitizeGitOutput(result.stderr || result.stdout), `❌ マージ失敗 [${repo.name}]\nコンフリクトの可能性があります。`));
    }
    logger.info('Git merge executed', { repo: repo.name, branch, ok: result.ok });
  }

  async handleBranchList(userId: string): Promise<void> {
    const repo = await this.requireRepo(userId);
    if (!repo) return;
    const result = await this.gitService.branchList(repo.path);
    const out = sanitizeGitOutput(result.ok ? (result.stdout || 'ブランチなし') : `エラー: ${result.stderr}`);
    await this.lineClient.sendPush(userId, `🌿 ブランチ一覧 [${repo.name}]\n\n${out}`);
  }

  async handleCheckout(branch: string, userId: string): Promise<void> {
    const repo = await this.requireRepo(userId);
    if (!repo) return;

    // Prevent git flag injection (e.g., --force, -B), relative refs (HEAD~1), and path traversal (..)
    if (!SAFE_BRANCH_RE.test(branch) || branch.startsWith('-') || branch.includes('..')) {
      await this.lineClient.sendPush(userId,
        `❌ 無効なブランチ名です: ${branch}\n` +
        `英数字・ハイフン・アンダースコア・スラッシュのみ使用できます。`,
      );
      return;
    }

    await this.lineClient.sendPush(userId, `🔄 ${branch} に切り替え中...`);
    const result = await this.gitService.checkout(repo.path, branch);
    if (result.ok) {
      await this.lineClient.sendPush(userId, `✅ ${branch} に切り替えました [${repo.name}]`);
    } else {
      await this.lineClient.sendPush(userId, truncate(sanitizeGitOutput(result.stderr), `❌ 切り替え失敗`));
    }
  }

  async handleDiff(userId: string): Promise<void> {
    const repo = await this.requireRepo(userId);
    if (!repo) return;
    const result = await this.gitService.diff(repo.path);
    const out = sanitizeGitOutput(result.stdout || result.stderr || '変更なし');
    await this.lineClient.sendPush(userId, truncate(out, `📝 差分 [${repo.name}]`));
  }

  async handleConfirm(userId: string): Promise<void> {
    const pending = this.gitSession.getPending();
    if (!pending) {
      await this.lineClient.sendPush(userId, '確認待ちのgit操作はありません。');
      return;
    }
    this.gitSession.clearPending();
    await this.lineClient.sendPush(userId, `⚙️ 実行中: ${pending.description}...`);
    const result = await this.gitService.run(pending.repoPath, pending.args);
    const confirmStdout = sanitizeGitOutput(result.stdout);
    const confirmStderr = sanitizeGitOutput(result.stderr);
    if (result.ok) {
      const out = confirmStdout || confirmStderr || '完了';
      await this.lineClient.sendPush(userId, truncate(out, `✅ 完了 [${pending.repoName}]`));
    } else {
      await this.lineClient.sendPush(userId, truncate(confirmStderr || confirmStdout, `❌ 失敗 [${pending.repoName}]`));
    }
    logger.info('Git operation confirmed and executed', {
      op: pending.operationType,
      repo: pending.repoName,
      ok: result.ok,
    });
  }

  async handleCancel(userId: string): Promise<void> {
    const pending = this.gitSession.getPending();
    if (!pending) {
      await this.lineClient.sendPush(userId, 'キャンセルする操作はありません。');
      return;
    }
    this.gitSession.clearPending();
    await this.lineClient.sendPush(userId, `🚫 キャンセルしました: ${pending.description}`);
  }

  private async requireRepo(userId: string): Promise<{ path: string; name: string } | null> {
    const repo = this.gitSession.getRepo();
    if (!repo) {
      await this.lineClient.sendPush(userId,
        'リポジトリが選択されていません。\n「リポジトリ一覧」で確認して「{名前}を選択」してください。',
      );
      return null;
    }
    return repo;
  }
}
