import { execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(execFile);

const ALLOWED_GIT_SUBCOMMANDS = new Set([
  'status', 'fetch', 'pull', 'push', 'log',
  'branch', 'checkout', 'diff', 'rev-parse', 'remote',
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
}
