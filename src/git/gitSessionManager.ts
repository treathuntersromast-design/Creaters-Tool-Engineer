import * as path from 'path';

export interface PendingGitAction {
  operationType: string;
  args: string[];
  description: string;
  repoPath: string;
  repoName: string;
  expiresAt: Date;
}

export class GitSessionManager {
  private repoPath: string | null = null;
  private repoName: string | null = null;
  private pending: PendingGitAction | null = null;

  selectRepo(repoPath: string): void {
    this.repoPath = repoPath;
    this.repoName = path.basename(repoPath);
    this.pending = null;
  }

  getRepo(): { path: string; name: string } | null {
    if (!this.repoPath || !this.repoName) return null;
    return { path: this.repoPath, name: this.repoName };
  }

  setPending(action: Omit<PendingGitAction, 'expiresAt'>): void {
    this.pending = { ...action, expiresAt: new Date(Date.now() + 5 * 60 * 1000) };
  }

  getPending(): PendingGitAction | null {
    if (!this.pending) return null;
    if (Date.now() > this.pending.expiresAt.getTime()) {
      this.pending = null;
      return null;
    }
    return this.pending;
  }

  clearPending(): void {
    this.pending = null;
  }

  clear(): void {
    this.repoPath = null;
    this.repoName = null;
    this.pending = null;
  }
}
