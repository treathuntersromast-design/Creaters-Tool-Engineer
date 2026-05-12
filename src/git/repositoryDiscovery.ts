import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

export interface RepoInfo {
  name: string;
  path: string;
  currentBranch: string | null;
  remoteUrl: string | null;
}

function isGitRepo(dirPath: string): boolean {
  try {
    return fs.existsSync(path.join(dirPath, '.git'));
  } catch {
    return false;
  }
}

function tryGitInfo(repoPath: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, {
      cwd: repoPath,
      timeout: 3000,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim() || null;
  } catch {
    return null;
  }
}

function scanDir(dirPath: string, depth: number): string[] {
  if (!fs.existsSync(dirPath)) return [];
  if (isGitRepo(dirPath)) return [dirPath];
  if (depth <= 0) return [];
  const results: string[] = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.')) {
        results.push(...scanDir(path.join(dirPath, e.name), depth - 1));
      }
    }
  } catch { /* ignore permission errors */ }
  return results;
}

function readGitHubDesktopRepos(): string[] {
  const appData = process.env['APPDATA'] ?? '';
  const candidate = path.join(appData, 'GitHub Desktop', 'repositories.json');
  if (!fs.existsSync(candidate)) return [];
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
    if (!Array.isArray(raw)) return [];
    return (raw as Record<string, unknown>[])
      .map((r) => (r['path'] ?? r['localPath'] ?? r['workingDirectory']) as string | undefined)
      .filter((p): p is string => typeof p === 'string' && isGitRepo(p));
  } catch {
    return [];
  }
}

export function discoverRepositories(): RepoInfo[] {
  const home = process.env['USERPROFILE'] ?? process.env['HOME'] ?? '';
  const searchRoots = [
    path.join(home, 'Documents', 'GitHub'),
    path.join(home, 'Documents', 'git'),
    path.join(home, 'source', 'repos'),
    path.join(home, 'projects'),
    path.join(home, 'repos'),
    path.join(home, 'dev'),
    path.join(home, 'Desktop'),
  ];

  // 環境変数でカスタムパスを追加可能（セミコロン区切り）
  const extra = process.env['GIT_REPOS_PATHS'] ?? '';
  if (extra) {
    searchRoots.push(...extra.split(';').map((s) => s.trim()).filter(Boolean));
  }

  const found = new Set<string>();

  for (const p of readGitHubDesktopRepos()) {
    found.add(path.resolve(p));
  }

  for (const root of searchRoots) {
    for (const p of scanDir(root, 2)) {
      found.add(path.resolve(p));
    }
  }

  return Array.from(found).map((repoPath) => ({
    name: path.basename(repoPath),
    path: repoPath,
    currentBranch: tryGitInfo(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']),
    remoteUrl: tryGitInfo(repoPath, ['remote', 'get-url', 'origin']),
  }));
}
