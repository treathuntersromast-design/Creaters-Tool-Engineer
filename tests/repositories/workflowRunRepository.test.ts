import { createTestDb } from '../helpers/testDb';

describe('WorkflowRunRepository', () => {
  function setup() {
    const repos = createTestDb();
    const p = repos.projectRepo.create({ name: 'P', slug: `s-${Date.now()}`, userId: 'U', workspacePath: '/tmp' });
    return { repos, projectId: p.id };
  }

  describe('create', () => {
    it('creates a run with RUNNING status', () => {
      const { repos, projectId } = setup();
      const run = repos.workflowRunRepo.create(projectId);
      expect(run.status).toBe('RUNNING');
      expect(run.startedAt).toBeTruthy();
      expect(run.finishedAt).toBeNull();
      expect(run.error).toBeNull();
    });

    it('assigns UUID id', () => {
      const { repos, projectId } = setup();
      const run = repos.workflowRunRepo.create(projectId);
      expect(run.id).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('hasRunning', () => {
    it('returns true when RUNNING run exists', () => {
      const { repos, projectId } = setup();
      repos.workflowRunRepo.create(projectId);
      expect(repos.workflowRunRepo.hasRunning(projectId)).toBe(true);
    });

    it('returns false when no runs exist', () => {
      const { repos, projectId } = setup();
      expect(repos.workflowRunRepo.hasRunning(projectId)).toBe(false);
    });

    it('returns false after run finishes SUCCEEDED', () => {
      const { repos, projectId } = setup();
      const run = repos.workflowRunRepo.create(projectId);
      repos.workflowRunRepo.finish(run.id, 'SUCCEEDED');
      expect(repos.workflowRunRepo.hasRunning(projectId)).toBe(false);
    });

    it('returns false after run finishes FAILED', () => {
      const { repos, projectId } = setup();
      const run = repos.workflowRunRepo.create(projectId);
      repos.workflowRunRepo.finish(run.id, 'FAILED', 'some error');
      expect(repos.workflowRunRepo.hasRunning(projectId)).toBe(false);
    });

    it('returns false after cancelRunning', () => {
      const { repos, projectId } = setup();
      repos.workflowRunRepo.create(projectId);
      repos.workflowRunRepo.cancelRunning(projectId);
      expect(repos.workflowRunRepo.hasRunning(projectId)).toBe(false);
    });
  });

  describe('finish', () => {
    it('sets SUCCEEDED with finishedAt', () => {
      const { repos, projectId } = setup();
      const run = repos.workflowRunRepo.create(projectId);
      repos.workflowRunRepo.finish(run.id, 'SUCCEEDED');
      const updated = repos.workflowRunRepo.findById(run.id)!;
      expect(updated.status).toBe('SUCCEEDED');
      expect(updated.finishedAt).toBeTruthy();
      expect(updated.error).toBeNull();
    });

    it('sets FAILED with error message', () => {
      const { repos, projectId } = setup();
      const run = repos.workflowRunRepo.create(projectId);
      repos.workflowRunRepo.finish(run.id, 'FAILED', 'pipeline exploded');
      const updated = repos.workflowRunRepo.findById(run.id)!;
      expect(updated.status).toBe('FAILED');
      expect(updated.error).toBe('pipeline exploded');
    });

    it('sets CANCELLED', () => {
      const { repos, projectId } = setup();
      const run = repos.workflowRunRepo.create(projectId);
      repos.workflowRunRepo.finish(run.id, 'CANCELLED');
      expect(repos.workflowRunRepo.findById(run.id)?.status).toBe('CANCELLED');
    });
  });

  describe('cancelRunning', () => {
    it('cancels all RUNNING runs for a project', () => {
      const { repos, projectId } = setup();
      const r1 = repos.workflowRunRepo.create(projectId);
      const r2 = repos.workflowRunRepo.create(projectId);
      repos.workflowRunRepo.cancelRunning(projectId);
      expect(repos.workflowRunRepo.findById(r1.id)?.status).toBe('CANCELLED');
      expect(repos.workflowRunRepo.findById(r2.id)?.status).toBe('CANCELLED');
    });

    it('does NOT affect other projects', () => {
      const repos = createTestDb();
      const p1 = repos.projectRepo.create({ name: 'P1', slug: 's1', userId: 'U', workspacePath: '/tmp' });
      const p2 = repos.projectRepo.create({ name: 'P2', slug: 's2', userId: 'U2', workspacePath: '/tmp' });
      const r1 = repos.workflowRunRepo.create(p1.id);
      const r2 = repos.workflowRunRepo.create(p2.id);

      repos.workflowRunRepo.cancelRunning(p1.id);

      expect(repos.workflowRunRepo.findById(r1.id)?.status).toBe('CANCELLED');
      expect(repos.workflowRunRepo.findById(r2.id)?.status).toBe('RUNNING'); // not affected
    });
  });

  describe('findByProjectId', () => {
    it('returns runs ordered by startedAt descending', () => {
      const { repos, projectId } = setup();
      repos.workflowRunRepo.create(projectId);
      repos.workflowRunRepo.create(projectId);
      const runs = repos.workflowRunRepo.findByProjectId(projectId);
      expect(runs.length).toBe(2);
    });
  });
});
