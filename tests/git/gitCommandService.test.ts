import { GitCommandService } from '../../src/git/gitCommandService';
import { GitService } from '../../src/git/gitService';
import { GitSessionManager } from '../../src/git/gitSessionManager';
import { LineClient } from '../../src/line/lineClient';

function buildService(gitOverrides: Partial<Record<keyof GitService, jest.Mock>> = {}) {
  const pushMessages: Array<{ userId: string; text: string }> = [];
  const lineClient = {
    sendPush: jest.fn(async (userId: string, text: string) => {
      pushMessages.push({ userId, text });
    }),
  } as unknown as LineClient;

  const gitService = {
    run: jest.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
    status: jest.fn().mockResolvedValue({ ok: true, stdout: '## main...origin/main', stderr: '' }),
    fetch: jest.fn().mockResolvedValue({ ok: true, stdout: 'Already up to date.', stderr: '' }),
    pull: jest.fn().mockResolvedValue({ ok: true, stdout: 'Already up to date.', stderr: '' }),
    push: jest.fn().mockResolvedValue({ ok: true, stdout: 'pushed', stderr: '' }),
    log: jest.fn().mockResolvedValue({ ok: true, stdout: 'abc1234 initial commit', stderr: '' }),
    branchList: jest.fn().mockResolvedValue({ ok: true, stdout: '* main\n  dev', stderr: '' }),
    checkout: jest.fn().mockResolvedValue({ ok: true, stdout: "Switched to branch 'dev'", stderr: '' }),
    diff: jest.fn().mockResolvedValue({ ok: true, stdout: '1 file changed', stderr: '' }),
    ...gitOverrides,
  } as unknown as GitService;

  const gitSession = new GitSessionManager();
  const svc = new GitCommandService(gitService, gitSession, lineClient);

  return { svc, gitService, gitSession, lineClient, pushMessages };
}

const FAKE_REPO_PATH = 'C:\\fake\\repo';
const FAKE_USER = 'U_test';

describe('GitCommandService', () => {
  // ── requireRepo guard ──────────────────────────────────────────────────
  describe('requireRepo guard', () => {
    const commands = ['handleStatus', 'handleLog', 'handleFetch', 'handlePull',
      'handlePush', 'handleBranchList', 'handleDiff'] as const;

    for (const cmd of commands) {
      it(`${cmd}: sends "no repo" message when none selected`, async () => {
        const { svc, pushMessages } = buildService();
        await svc[cmd](FAKE_USER);
        expect(pushMessages[0]?.text).toContain('リポジトリが選択されていません');
      });
    }

    it('handleCheckout: sends "no repo" message when none selected', async () => {
      const { svc, pushMessages } = buildService();
      await svc.handleCheckout('main', FAKE_USER);
      expect(pushMessages[0]?.text).toContain('リポジトリが選択されていません');
    });
  });

  // ── handleListRepos ─────────────────────────────────────────────────────
  describe('handleListRepos', () => {
    it('sends "not found" message when discovery returns empty', async () => {
      const { svc, pushMessages } = buildService();
      jest.spyOn(require('../../src/git/repositoryDiscovery'), 'discoverRepositories').mockReturnValue([]);
      await svc.handleListRepos(FAKE_USER);
      expect(pushMessages[0]?.text).toContain('リポジトリが見つかりませんでした');
    });
  });

  // ── handleSelectRepo ────────────────────────────────────────────────────
  describe('handleSelectRepo', () => {
    it('sends "not found" when no match', async () => {
      const { svc, pushMessages } = buildService();
      jest.spyOn(require('../../src/git/repositoryDiscovery'), 'discoverRepositories')
        .mockReturnValue([{ name: 'my-app', path: FAKE_REPO_PATH, currentBranch: 'main', remoteUrl: '' }]);
      await svc.handleSelectRepo('zzz-no-match', FAKE_USER);
      expect(pushMessages[0]?.text).toContain('一致するリポジトリが見つかりませんでした');
    });

    it('selects repo and sends confirmation', async () => {
      const { svc, gitSession, pushMessages } = buildService();
      jest.spyOn(require('../../src/git/repositoryDiscovery'), 'discoverRepositories')
        .mockReturnValue([{ name: 'my-app', path: FAKE_REPO_PATH, currentBranch: 'main', remoteUrl: 'https://github.com/x/y' }]);
      await svc.handleSelectRepo('my-app', FAKE_USER);
      expect(gitSession.getRepo()?.path).toBe(FAKE_REPO_PATH);
      expect(pushMessages[0]?.text).toContain('my-app');
    });
  });

  // ── handleStatus ────────────────────────────────────────────────────────
  describe('handleStatus', () => {
    it('calls gitService.status and sends result', async () => {
      const { svc, gitService, gitSession, pushMessages } = buildService();
      gitSession.selectRepo(FAKE_REPO_PATH);
      await svc.handleStatus(FAKE_USER);
      expect(gitService.status).toHaveBeenCalledWith(FAKE_REPO_PATH);
      expect(pushMessages[0]?.text).toContain('git status');
    });

    it('truncates very long output to ≤ 4000 chars', async () => {
      const longOutput = 'M '.repeat(2000); // ~4000 chars
      const { svc, gitSession, pushMessages } = buildService({
        status: jest.fn().mockResolvedValue({ ok: true, stdout: longOutput, stderr: '' }),
      });
      gitSession.selectRepo(FAKE_REPO_PATH);
      await svc.handleStatus(FAKE_USER);
      expect(pushMessages[0]!.text.length).toBeLessThanOrEqual(4100);
    });
  });

  // ── handleLog ───────────────────────────────────────────────────────────
  describe('handleLog', () => {
    it('calls gitService.log and sends result', async () => {
      const { svc, gitService, gitSession, pushMessages } = buildService();
      gitSession.selectRepo(FAKE_REPO_PATH);
      await svc.handleLog(FAKE_USER);
      expect(gitService.log).toHaveBeenCalledWith(FAKE_REPO_PATH);
      expect(pushMessages[0]?.text).toContain('コミット履歴');
    });

    it('shows error output when git log fails', async () => {
      const { svc, gitSession, pushMessages } = buildService({
        log: jest.fn().mockResolvedValue({ ok: false, stdout: '', stderr: 'not a git repo' }),
      });
      gitSession.selectRepo(FAKE_REPO_PATH);
      await svc.handleLog(FAKE_USER);
      expect(pushMessages[0]?.text).toContain('エラー');
    });
  });

  // ── handleFetch ──────────────────────────────────────────────────────────
  describe('handleFetch', () => {
    it('sends "fetching" then result', async () => {
      const { svc, gitSession, pushMessages } = buildService();
      gitSession.selectRepo(FAKE_REPO_PATH);
      await svc.handleFetch(FAKE_USER);
      expect(pushMessages[0]?.text).toContain('フェッチ中');
      expect(pushMessages[1]?.text).toContain('フェッチ完了');
    });

    it('sends failure message on error', async () => {
      const { svc, gitSession, pushMessages } = buildService({
        fetch: jest.fn().mockResolvedValue({ ok: false, stdout: '', stderr: 'connection refused' }),
      });
      gitSession.selectRepo(FAKE_REPO_PATH);
      await svc.handleFetch(FAKE_USER);
      expect(pushMessages[1]?.text).toContain('フェッチ失敗');
    });
  });

  // ── handlePull ──────────────────────────────────────────────────────────
  describe('handlePull', () => {
    it('sends "pulling" then result', async () => {
      const { svc, gitSession, pushMessages } = buildService();
      gitSession.selectRepo(FAKE_REPO_PATH);
      await svc.handlePull(FAKE_USER);
      expect(pushMessages[0]?.text).toContain('プル中');
      expect(pushMessages[1]?.text).toContain('プル完了');
    });

    it('sends failure message on conflict', async () => {
      const { svc, gitSession, pushMessages } = buildService({
        pull: jest.fn().mockResolvedValue({ ok: false, stdout: '', stderr: 'CONFLICT' }),
      });
      gitSession.selectRepo(FAKE_REPO_PATH);
      await svc.handlePull(FAKE_USER);
      expect(pushMessages[1]?.text).toContain('プル失敗');
    });
  });

  // ── handlePush (HIGH risk — requires confirmation) ──────────────────────
  describe('handlePush', () => {
    it('sets pending action and sends confirmation request', async () => {
      const { svc, gitService, gitSession, pushMessages } = buildService();
      gitSession.selectRepo(FAKE_REPO_PATH);
      (gitService.run as jest.Mock).mockResolvedValue({ ok: true, stdout: 'main', stderr: '' });

      await svc.handlePush(FAKE_USER);

      expect(pushMessages[0]?.text).toContain('高リスク操作');
      expect(pushMessages[0]?.text).toContain('はい');
    });

    it('does NOT push immediately — waits for confirmation', async () => {
      const { svc, gitService, gitSession } = buildService();
      gitSession.selectRepo(FAKE_REPO_PATH);
      (gitService.run as jest.Mock).mockResolvedValue({ ok: true, stdout: 'main', stderr: '' });

      await svc.handlePush(FAKE_USER);

      expect(gitService.push).not.toHaveBeenCalled();
    });
  });

  // ── handleConfirm / handleCancel ─────────────────────────────────────────
  describe('handleConfirm', () => {
    it('executes pending action', async () => {
      const { svc, gitService, gitSession, pushMessages } = buildService();
      gitSession.selectRepo(FAKE_REPO_PATH);
      (gitService.run as jest.Mock)
        .mockResolvedValueOnce({ ok: true, stdout: 'main', stderr: '' })  // rev-parse
        .mockResolvedValueOnce({ ok: true, stdout: 'pushed!', stderr: '' }); // actual push

      await svc.handlePush(FAKE_USER);
      await svc.handleConfirm(FAKE_USER);

      const done = pushMessages.find((m) => m.text.includes('完了'));
      expect(done).toBeDefined();
    });

    it('sends "no pending" when nothing is waiting', async () => {
      const { svc, pushMessages } = buildService();
      await svc.handleConfirm(FAKE_USER);
      expect(pushMessages[0]?.text).toContain('確認待ちのgit操作はありません');
    });

    it('pending action expires after 5 minutes', () => {
      const { svc, gitSession } = buildService();
      gitSession.selectRepo(FAKE_REPO_PATH);
      gitSession.setPending({
        operationType: 'GIT_PUSH',
        args: ['push'],
        description: 'test push',
        repoPath: FAKE_REPO_PATH,
        repoName: 'repo',
      });

      // Simulate expiry by overriding expiresAt
      const pending = gitSession.getPending()!;
      (pending as any).expiresAt = new Date(Date.now() - 1000);

      expect(gitSession.getPending()).toBeNull();
    });
  });

  describe('handleCancel', () => {
    it('clears pending action', async () => {
      const { svc, gitService, gitSession, pushMessages } = buildService();
      gitSession.selectRepo(FAKE_REPO_PATH);
      (gitService.run as jest.Mock).mockResolvedValue({ ok: true, stdout: 'main', stderr: '' });

      await svc.handlePush(FAKE_USER);
      await svc.handleCancel(FAKE_USER);

      expect(pushMessages[1]?.text).toContain('キャンセル');
      expect(gitSession.getPending()).toBeNull();
    });

    it('sends "nothing to cancel" when no pending action', async () => {
      const { svc, pushMessages } = buildService();
      await svc.handleCancel(FAKE_USER);
      expect(pushMessages[0]?.text).toContain('キャンセルする操作はありません');
    });
  });

  // ── handleCheckout (branch validation) ──────────────────────────────────
  describe('handleCheckout', () => {
    it('checks out valid branch', async () => {
      const { svc, gitService, gitSession, pushMessages } = buildService();
      gitSession.selectRepo(FAKE_REPO_PATH);
      await svc.handleCheckout('feature/login', FAKE_USER);
      expect(gitService.checkout).toHaveBeenCalledWith(FAKE_REPO_PATH, 'feature/login');
      expect(pushMessages[1]?.text).toContain('切り替えました');
    });

    it('rejects branch names with shell metacharacters', async () => {
      const { svc, gitService, gitSession, pushMessages } = buildService();
      gitSession.selectRepo(FAKE_REPO_PATH);
      await svc.handleCheckout('main; rm -rf /', FAKE_USER);
      expect(gitService.checkout).not.toHaveBeenCalled();
      expect(pushMessages[0]?.text).toContain('無効なブランチ名');
    });

    it('rejects branch names starting with --flag', async () => {
      const { svc, gitService, gitSession, pushMessages } = buildService();
      gitSession.selectRepo(FAKE_REPO_PATH);
      await svc.handleCheckout('--force', FAKE_USER);
      expect(gitService.checkout).not.toHaveBeenCalled();
      expect(pushMessages[0]?.text).toContain('無効なブランチ名');
    });

    it('rejects relative branch names like HEAD~1', async () => {
      const { svc, gitService, gitSession, pushMessages } = buildService();
      gitSession.selectRepo(FAKE_REPO_PATH);
      await svc.handleCheckout('HEAD~1', FAKE_USER);
      expect(gitService.checkout).not.toHaveBeenCalled();
      expect(pushMessages[0]?.text).toContain('無効なブランチ名');
    });

    it('sends failure message on checkout error', async () => {
      const { svc, gitSession, pushMessages } = buildService({
        checkout: jest.fn().mockResolvedValue({ ok: false, stdout: '', stderr: 'branch not found' }),
      });
      gitSession.selectRepo(FAKE_REPO_PATH);
      await svc.handleCheckout('no-such-branch', FAKE_USER);
      expect(pushMessages[1]?.text).toContain('切り替え失敗');
    });
  });

  // ── handleDiff ──────────────────────────────────────────────────────────
  describe('handleDiff', () => {
    it('calls gitService.diff and sends result', async () => {
      const { svc, gitService, gitSession, pushMessages } = buildService();
      gitSession.selectRepo(FAKE_REPO_PATH);
      await svc.handleDiff(FAKE_USER);
      expect(gitService.diff).toHaveBeenCalledWith(FAKE_REPO_PATH);
      expect(pushMessages[0]?.text).toContain('差分');
    });
  });

  // ── handleBranchList ────────────────────────────────────────────────────
  describe('handleBranchList', () => {
    it('calls gitService.branchList and sends result', async () => {
      const { svc, gitService, gitSession, pushMessages } = buildService();
      gitSession.selectRepo(FAKE_REPO_PATH);
      await svc.handleBranchList(FAKE_USER);
      expect(gitService.branchList).toHaveBeenCalledWith(FAKE_REPO_PATH);
      expect(pushMessages[0]?.text).toContain('ブランチ一覧');
    });
  });
});
