/**
 * Security tests for GitService:
 * - Subcommand allowlist (G-02): only permitted git subcommands may be executed
 */
import { GitService } from '../../src/git/gitService';

describe('GitService subcommand allowlist (G-02)', () => {
  const svc = new GitService();

  it('rejects an unknown subcommand (gc)', async () => {
    const result = await svc.run('/any/path', ['gc']);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('not allowed');
  });

  it('rejects empty args array', async () => {
    const result = await svc.run('/any/path', []);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('not allowed');
  });

  it('rejects filter-branch', async () => {
    const result = await svc.run('/any/path', ['filter-branch', '--all']);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('not allowed');
  });

  it('rejects clean', async () => {
    const result = await svc.run('/any/path', ['clean', '-fd']);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('not allowed');
  });

  it('rejects stash', async () => {
    const result = await svc.run('/any/path', ['stash', 'pop']);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('not allowed');
  });

  it('rejects reset (--hard would be destructive)', async () => {
    const result = await svc.run('/any/path', ['reset', '--hard', 'HEAD~1']);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('not allowed');
  });

  it('rejects bisect', async () => {
    const result = await svc.run('/any/path', ['bisect', 'bad']);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain('not allowed');
  });

  // Verify allowed subcommands are not rejected by the allowlist guard
  // (They will fail due to non-existent path, but NOT with "not allowed")
  const allowedSubcommands = [
    'status', 'fetch', 'pull', 'push', 'log',
    'branch', 'checkout', 'diff', 'rev-parse', 'remote',
  ];

  for (const cmd of allowedSubcommands) {
    it(`does not reject allowed subcommand: ${cmd}`, async () => {
      const result = await svc.run('/non/existent/path', [cmd]);
      // May fail due to missing path, but must NOT fail with "not allowed"
      expect(result.stderr).not.toContain('not allowed');
    });
  }
});
