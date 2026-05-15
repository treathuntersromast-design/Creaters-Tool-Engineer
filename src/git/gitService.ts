import { execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(execFile);

const ALLOWED_GIT_SUBCOMMANDS = new Set([
  'status', 'fetch', 'pull', 'push', 'log',
  'branch', 'checkout', 'diff', 'rev-parse', 'remote', 'ls-files', 'init',
  'add', 'commit', 'merge',
]);

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export class GitService {
  async run(repoPath: string, args: string[]): Promise<GitResult> {
    const subcommand = args[0];
    if (!subcommand || !ALLOWED_GIT_SUBCOMMANDS.has(subcommand)) {
      return { ok: false, stdout: '', stderr: `git subcommand not allowed: ${subcommand ?? '(empty)'}` };
    }
    try {
      const { stdout, stderr } = await execAsync('git', args, {
        cwd: repoPath,
        timeout: 60_000,
        encoding: 'utf-8',
      });
      return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
    } catch (err: unknown) {
      const e = err as { stdout?: string; stderr?: string; message?: string };
      return {
        ok: false,
        stdout: e.stdout?.trim() ?? '',
        stderr: e.stderr?.trim() ?? e.message ?? 'Unknown error',
      };
    }
  }

  status(repoPath: string): Promise<GitResult> {
    return this.run(repoPath, ['status', '--short', '--branch']);
  }

  fetch(repoPath: string): Promise<GitResult> {
    return this.run(repoPath, ['fetch', '--prune']);
  }

  pull(repoPath: string): Promise<GitResult> {
    return this.run(repoPath, ['pull']);
  }

  push(repoPath: string): Promise<GitResult> {
    return this.run(repoPath, ['push']);
  }

  log(repoPath: string, count = 15): Promise<GitResult> {
    return this.run(repoPath, ['log', '--oneline', `-${count}`]);
  }

  branchList(repoPath: string): Promise<GitResult> {
    return this.run(repoPath, ['branch', '-a', '--no-color']);
  }

  checkout(repoPath: string, branch: string): Promise<GitResult> {
    return this.run(repoPath, ['checkout', branch]);
  }

  diff(repoPath: string): Promise<GitResult> {
    return this.run(repoPath, ['diff', '--stat']);
  }

  init(repoPath: string): Promise<GitResult> {
    return this.run(repoPath, ['init']);
  }

  addAll(repoPath: string): Promise<GitResult> {
    return this.run(repoPath, ['add', '-A']);
  }

  /** コミットメッセージはコマンド側で `yyyyMMdd_概要` 形式に整形済みであること */
  commit(repoPath: string, message: string): Promise<GitResult> {
    return this.run(repoPath, ['commit', '-m', message]);
  }

  diffCachedStat(repoPath: string): Promise<GitResult> {
    return this.run(repoPath, ['diff', '--cached', '--stat']);
  }

  merge(repoPath: string, branch: string): Promise<GitResult> {
    return this.run(repoPath, ['merge', branch]);
  }
}
