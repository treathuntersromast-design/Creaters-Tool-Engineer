import { createTestDb } from '../helpers/testDb';

describe('ProjectRepository', () => {
  describe('create', () => {
    it('creates a project with CREATED status and isActive=1', () => {
      const { projectRepo } = createTestDb();
      const p = makeProject({ projectRepo } as any);
      expect(p.status).toBe('CREATED');
      expect(p.isActive).toBe(1);
      expect(p.revisionNumber).toBe(0);
      expect(p.previousStatus).toBeNull();
      expect(p.lastError).toBeNull();
    });

    it('assigns a UUID id', () => {
      const { projectRepo } = createTestDb();
      const p = makeProject({ projectRepo } as any);
      expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('enforces UNIQUE constraint on slug', () => {
      const repos = createTestDb();
      makeProject(repos, { slug: 'same-slug' });
      expect(() => makeProject(repos, { slug: 'same-slug' })).toThrow();
    });
  });

  describe('findById', () => {
    it('returns the project by id', () => {
      const repos = createTestDb();
      const p = makeProject(repos);
      expect(repos.projectRepo.findById(p.id)).toMatchObject({ id: p.id, name: p.name });
    });

    it('returns undefined for unknown id', () => {
      const repos = createTestDb();
      expect(repos.projectRepo.findById('non-existent-id')).toBeUndefined();
    });
  });

  describe('findActiveByUserId', () => {
    it('returns active project for user', () => {
      const repos = createTestDb();
      const p = makeProject(repos, { userId: 'U_alice' });
      const found = repos.projectRepo.findActiveByUserId('U_alice');
      expect(found?.id).toBe(p.id);
    });

    it('returns undefined when no active project', () => {
      const repos = createTestDb();
      expect(repos.projectRepo.findActiveByUserId('U_nobody')).toBeUndefined();
    });

    it('does NOT return COMPLETED projects as active', () => {
      const repos = createTestDb();
      const p = makeProject(repos, { userId: 'U_bob' });
      repos.projectRepo.setCompleted(p.id);
      expect(repos.projectRepo.findActiveByUserId('U_bob')).toBeUndefined();
    });

    it('does NOT return FAILED projects as active', () => {
      const repos = createTestDb();
      const p = makeProject(repos, { userId: 'U_carol' });
      repos.projectRepo.setFailed(p.id, 'some error');
      expect(repos.projectRepo.findActiveByUserId('U_carol')).toBeUndefined();
    });

    it('does NOT return STOPPED with isActive=0 as active', () => {
      const repos = createTestDb();
      const p = makeProject(repos, { userId: 'U_dave' });
      repos.projectRepo.updateStatus(p.id, 'STOPPED', p.status);
      repos.projectRepo.setActive(p.id, false);
      expect(repos.projectRepo.findActiveByUserId('U_dave')).toBeUndefined();
    });

    it('returns the most recent active project when multiple exist', async () => {
      const repos = createTestDb();
      makeProject(repos, { userId: 'U_multi', slug: 'slug-old', name: 'Old' });
      // Ensure different timestamps for reliable ORDER BY createdAt DESC
      await new Promise((r) => setTimeout(r, 2));
      const p2 = repos.projectRepo.create({
        name: 'New', slug: 'slug-new', userId: 'U_multi', workspacePath: '/tmp/new'
      });
      const found = repos.projectRepo.findActiveByUserId('U_multi');
      expect(found?.id).toBe(p2.id);
    });
  });

  describe('updateStatus', () => {
    it('updates status', () => {
      const repos = createTestDb();
      const p = makeProject(repos);
      repos.projectRepo.updateStatus(p.id, 'HEARING');
      expect(repos.projectRepo.findById(p.id)?.status).toBe('HEARING');
    });

    it('saves previousStatus when provided', () => {
      const repos = createTestDb();
      const p = makeProject(repos);
      repos.projectRepo.updateStatus(p.id, 'STOPPED', 'REQUIREMENTS');
      const updated = repos.projectRepo.findById(p.id)!;
      expect(updated.status).toBe('STOPPED');
      expect(updated.previousStatus).toBe('REQUIREMENTS');
    });

    it('does NOT overwrite previousStatus when not provided', () => {
      const repos = createTestDb();
      const p = makeProject(repos);
      repos.projectRepo.updateStatus(p.id, 'STOPPED', 'HEARING');
      repos.projectRepo.updateStatus(p.id, 'HEARING'); // no previousStatus arg
      const updated = repos.projectRepo.findById(p.id)!;
      expect(updated.previousStatus).toBe('HEARING'); // unchanged
    });
  });

  describe('setFailed', () => {
    it('sets status to FAILED, isActive=0, lastError', () => {
      const repos = createTestDb();
      const p = makeProject(repos);
      repos.projectRepo.setFailed(p.id, 'pipeline error');
      const updated = repos.projectRepo.findById(p.id)!;
      expect(updated.status).toBe('FAILED');
      expect(updated.isActive).toBe(0);
      expect(updated.lastError).toBe('pipeline error');
    });
  });

  describe('setCompleted', () => {
    it('sets status to COMPLETED and isActive=0', () => {
      const repos = createTestDb();
      const p = makeProject(repos);
      repos.projectRepo.setCompleted(p.id);
      const updated = repos.projectRepo.findById(p.id)!;
      expect(updated.status).toBe('COMPLETED');
      expect(updated.isActive).toBe(0);
    });
  });

  describe('incrementRevision', () => {
    it('increments revision number and returns new value', () => {
      const repos = createTestDb();
      const p = makeProject(repos);
      const rev1 = repos.projectRepo.incrementRevision(p.id);
      expect(rev1).toBe(1);
      const rev2 = repos.projectRepo.incrementRevision(p.id);
      expect(rev2).toBe(2);
    });
  });

  describe('clearPreviousStatus', () => {
    it('sets previousStatus to null', () => {
      const repos = createTestDb();
      const p = makeProject(repos);
      repos.projectRepo.updateStatus(p.id, 'STOPPED', 'HEARING');
      repos.projectRepo.clearPreviousStatus(p.id);
      expect(repos.projectRepo.findById(p.id)?.previousStatus).toBeNull();
    });
  });

  describe('setActive', () => {
    it('sets isActive to 0', () => {
      const repos = createTestDb();
      const p = makeProject(repos);
      repos.projectRepo.setActive(p.id, false);
      expect(repos.projectRepo.findById(p.id)?.isActive).toBe(0);
    });

    it('sets isActive back to 1', () => {
      const repos = createTestDb();
      const p = makeProject(repos);
      repos.projectRepo.setActive(p.id, false);
      repos.projectRepo.setActive(p.id, true);
      expect(repos.projectRepo.findById(p.id)?.isActive).toBe(1);
    });
  });

  describe('deactivateAllByUserId', () => {
    it('stops and deactivates all active projects for user', () => {
      const repos = createTestDb();
      const p1 = repos.projectRepo.create({ name: 'P1', slug: 's1', userId: 'U_x', workspacePath: '/tmp/p1' });
      const p2 = repos.projectRepo.create({ name: 'P2', slug: 's2', userId: 'U_x', workspacePath: '/tmp/p2' });
      repos.projectRepo.updateStatus(p1.id, 'HEARING');
      repos.projectRepo.updateStatus(p2.id, 'REQUIREMENTS');

      repos.projectRepo.deactivateAllByUserId('U_x');

      expect(repos.projectRepo.findById(p1.id)?.isActive).toBe(0);
      expect(repos.projectRepo.findById(p2.id)?.isActive).toBe(0);
      expect(repos.projectRepo.findActiveByUserId('U_x')).toBeUndefined();
    });

    it('does NOT deactivate projects of other users', () => {
      const repos = createTestDb();
      const p = makeProject(repos, { userId: 'U_other' });
      repos.projectRepo.updateStatus(p.id, 'HEARING');

      repos.projectRepo.deactivateAllByUserId('U_x');

      expect(repos.projectRepo.findById(p.id)?.isActive).toBe(1);
    });
  });
});

// ----------------------------------------------------------------
// helpers needed because createTestDb returns TestRepos not shorthand
// ----------------------------------------------------------------
function makeProject(
  repos: ReturnType<typeof createTestDb>,
  opts: { name?: string; slug?: string; userId?: string } = {}
) {
  return repos.projectRepo.create({
    name:          opts.name ?? 'Test Project',
    slug:          opts.slug ?? `slug-${Date.now()}-${Math.random()}`,
    userId:        opts.userId ?? 'U_test',
    workspacePath: '/tmp/ws',
  });
}
