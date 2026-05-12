/**
 * Security tests for git command service:
 * - Branch name validation (flag injection, path traversal)
 * - Remote URL credential scrubbing
 */

// Import the sanitizeRemoteUrl via the module; we test indirectly through handleSelectRepo
import { GitCommandService } from '../../src/git/gitCommandService';
import { GitService } from '../../src/git/gitService';
import { GitSessionManager } from '../../src/git/gitSessionManager';

function buildService() {
  const pushMessages: Array<{ userId: string; text: string }> = [];
  const lineClient = {
    sendPush: jest.fn(async (userId: string, text: string) => {
      pushMessages.push({ userId, text });
    }),
  };
  const gitService = {
    run: jest.fn().mockResolvedValue({ ok: true, stdout: 'ok', stderr: '' }),
    status: jest.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
    fetch: jest.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
    pull: jest.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
    push: jest.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
    log: jest.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
    branchList: jest.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
    checkout: jest.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
    diff: jest.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
  };
  const gitSession = new GitSessionManager();
  const service = new GitCommandService(
    gitService as unknown as GitService,
    gitSession,
    lineClient as any,
  );
  return { service, gitService, lineClient, pushMessages, gitSession };
}

describe('Git branch name validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects branch starting with dash (flag injection)', async () => {
    const { service, gitService, pushMessages } = buildService();
    service['gitSession'].selectRepo('/repos/test');

    await service.handleCheckout('--force', 'U1');

    expect(gitService.checkout).not.toHaveBeenCalled();
    expect(pushMessages[0]?.text).toContain('無効なブランチ名');
  });

  it('rejects branch with .git flag variant -B', async () => {
    const { service, gitService, pushMessages } = buildService();
    service['gitSession'].selectRepo('/repos/test');

    await service.handleCheckout('-B', 'U1');

    expect(gitService.checkout).not.toHaveBeenCalled();
    expect(pushMessages[0]?.text).toContain('無効なブランチ名');
  });

  it('rejects branch containing .. (path traversal)', async () => {
    const { service, gitService, pushMessages } = buildService();
    service['gitSession'].selectRepo('/repos/test');

    await service.handleCheckout('..', 'U1');

    expect(gitService.checkout).not.toHaveBeenCalled();
    expect(pushMessages[0]?.text).toContain('無効なブランチ名');
  });

  it('rejects branch with embedded ..', async () => {
    const { service, gitService, pushMessages } = buildService();
    service['gitSession'].selectRepo('/repos/test');

    await service.handleCheckout('feature/../main', 'U1');

    expect(gitService.checkout).not.toHaveBeenCalled();
    expect(pushMessages[0]?.text).toContain('無効なブランチ名');
  });

  it('rejects shell metacharacters in branch name', async () => {
    const { service, gitService, pushMessages } = buildService();
    service['gitSession'].selectRepo('/repos/test');

    await service.handleCheckout('main;rm -rf /', 'U1');

    expect(gitService.checkout).not.toHaveBeenCalled();
    expect(pushMessages[0]?.text).toContain('無効なブランチ名');
  });

  it('allows valid branch names', async () => {
    const { service, gitService, pushMessages } = buildService();
    service['gitSession'].selectRepo('/repos/test');

    for (const branch of ['main', 'feature/login', 'release-1.0', 'dev_branch']) {
      jest.clearAllMocks();
      pushMessages.length = 0;
      await service.handleCheckout(branch, 'U1');
      expect(gitService.checkout).toHaveBeenCalledWith('/repos/test', branch);
    }
  });
});

describe('Remote URL credential scrubbing', () => {
  it('does not expose credentials in remote URL sent to LINE', async () => {
    const { service, pushMessages } = buildService();

    // Mock discoverRepositories to return a repo with credentials in URL
    const originalDiscover = require('../../src/git/repositoryDiscovery').discoverRepositories;
    jest.mock('../../src/git/repositoryDiscovery', () => ({
      discoverRepositories: jest.fn().mockReturnValue([{
        name: 'my-private-repo',
        path: '/repos/my-private-repo',
        currentBranch: 'main',
        remoteUrl: 'https://token123:x-oauth-basic@github.com/user/my-private-repo.git',
      }]),
    }));

    // Invalidate cache to pick up mocked repos
    service.invalidateCache();

    await service.handleSelectRepo('my-private-repo', 'U1');

    const text = pushMessages[0]?.text ?? '';
    expect(text).not.toContain('token123');
    expect(text).not.toContain('x-oauth-basic');
    // URL should be present but without credentials
    if (text.includes('Remote:')) {
      expect(text).toContain('github.com');
      expect(text).not.toMatch(/:[^@]+@/); // no user:pass@
    }

    jest.unmock('../../src/git/repositoryDiscovery');
  });
});

describe('Git output sanitization — credential URL leak prevention (G-01)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('strips credential URL from fetch error stderr before sending to LINE', async () => {
    const { service, gitService, gitSession, pushMessages } = buildService();
    gitSession.selectRepo('/repos/test');
    (gitService.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      stdout: '',
      stderr: "fatal: unable to access 'https://token123:secret@github.com/org/repo.git/': SSL error",
    });

    await service.handleFetch('U1');

    const text = pushMessages.map((m) => m.text).join('\n');
    expect(text).not.toContain('token123');
    expect(text).not.toContain('secret@');
    expect(text).toContain('github.com');
  });

  it('strips credential URL from pull error stderr before sending to LINE', async () => {
    const { service, gitService, gitSession, pushMessages } = buildService();
    gitSession.selectRepo('/repos/test');
    (gitService.pull as jest.Mock).mockResolvedValue({
      ok: false,
      stdout: '',
      stderr: "error: failed to push refs to 'https://user:pass123@github.com/org/repo.git'",
    });

    await service.handlePull('U1');

    const text = pushMessages.map((m) => m.text).join('\n');
    expect(text).not.toContain('pass123');
    expect(text).toContain('github.com');
  });

  it('strips credential URL from log stdout before sending to LINE', async () => {
    const { service, gitService, gitSession, pushMessages } = buildService();
    gitSession.selectRepo('/repos/test');
    (gitService.log as jest.Mock).mockResolvedValue({
      ok: true,
      stdout: 'abc1234 Merge from https://mytoken:abc@github.com/org/repo.git',
      stderr: '',
    });

    await service.handleLog('U1');

    const text = pushMessages.map((m) => m.text).join('\n');
    expect(text).not.toContain('mytoken');
    expect(text).not.toContain('abc@');
    expect(text).toContain('github.com');
  });

  it('strips credential URL from checkout stderr before sending to LINE', async () => {
    const { service, gitService, gitSession, pushMessages } = buildService();
    gitSession.selectRepo('/repos/test');
    (gitService.checkout as jest.Mock).mockResolvedValue({
      ok: false,
      stdout: '',
      stderr: "error: pathspec 'main' did not match — remote 'https://ci:citoken@github.com/org/repo.git'",
    });

    await service.handleCheckout('main', 'U1');

    const text = pushMessages.map((m) => m.text).join('\n');
    expect(text).not.toContain('citoken');
    expect(text).toContain('github.com');
  });

  it('strips credential URL from confirm (push) output before sending to LINE', async () => {
    const { service, gitService, gitSession, pushMessages } = buildService();
    gitSession.selectRepo('/repos/test');
    gitSession.setPending({
      operationType: 'GIT_PUSH',
      args: ['push'],
      description: 'push to remote',
      repoPath: '/repos/test',
      repoName: 'test',
    });
    (gitService.run as jest.Mock).mockResolvedValue({
      ok: false,
      stdout: '',
      stderr: "remote: https://user:secret99@github.com/org/repo.git: push rejected",
    });

    await service.handleConfirm('U1');

    const text = pushMessages.map((m) => m.text).join('\n');
    expect(text).not.toContain('secret99');
    expect(text).toContain('github.com');
  });
});

describe('No repo selected guard', () => {
  it('sends error if no repo selected before git status', async () => {
    const { service, pushMessages } = buildService();
    // gitSession has no repo selected
    await service.handleStatus('U1');
    expect(pushMessages[0]?.text).toContain('選択されていません');
  });

  it('sends error if no repo selected before checkout', async () => {
    const { service, pushMessages } = buildService();
    await service.handleCheckout('main', 'U1');
    expect(pushMessages[0]?.text).toContain('選択されていません');
  });
});
