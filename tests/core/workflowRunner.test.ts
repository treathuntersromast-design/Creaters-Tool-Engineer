import { WorkflowRunner } from '../../src/core/workflowRunner';
import { createTestDb } from '../helpers/testDb';

function makeMocks(overrides: { pipelineShouldFail?: boolean } = {}) {
  const repos = createTestDb();
  const project = repos.projectRepo.create({ name: 'P', slug: `s-${Date.now()}`, userId: 'U', workspacePath: '/tmp' });

  let pipelineCallCount = 0;

  const workflowService = {
    startPipeline: jest.fn(async (_projectId: string, _runId: string) => {
      pipelineCallCount++;
      if (overrides.pipelineShouldFail) throw new Error('pipeline failed');
    }),
  };

  const lineClient = {
    sendPush: jest.fn().mockResolvedValue(undefined),
  };

  const runner = new WorkflowRunner(
    workflowService as any,
    repos.workflowRunRepo,
    repos.projectRepo,
    lineClient as any,
  );

  return { runner, repos, project, workflowService, lineClient, getPipelineCallCount: () => pipelineCallCount };
}

// Helper: wait for async fire-and-forget to settle
const flush = () => new Promise((r) => setImmediate(r));

describe('WorkflowRunner', () => {
  describe('happy path', () => {
    it('starts a pipeline run', async () => {
      const { runner, repos, project, workflowService } = makeMocks();
      runner.run(project.id);
      await flush();
      expect(workflowService.startPipeline).toHaveBeenCalledTimes(1);
      expect(workflowService.startPipeline).toHaveBeenCalledWith(project.id, expect.any(String));
    });

    it('creates a workflow_run record with RUNNING status', async () => {
      const { runner, repos, project } = makeMocks();
      runner.run(project.id);
      // Check immediately after call (before async settles)
      expect(repos.workflowRunRepo.hasRunning(project.id)).toBe(true);
      await flush();
    });

    it('sets workflow_run to SUCCEEDED on success', async () => {
      const { runner, repos, project } = makeMocks();
      runner.run(project.id);
      await flush();
      const runs = repos.workflowRunRepo.findByProjectId(project.id);
      expect(runs[0]?.status).toBe('SUCCEEDED');
    });

    it('isRunning returns false after success', async () => {
      const { runner, project } = makeMocks();
      runner.run(project.id);
      await flush();
      expect(runner.isRunning(project.id)).toBe(false);
    });
  });

  describe('double-start prevention', () => {
    it('does NOT start a second pipeline if memory lock is held', async () => {
      const { runner, project, workflowService } = makeMocks();
      runner.run(project.id);
      runner.run(project.id); // second call before first settles
      await flush();
      expect(workflowService.startPipeline).toHaveBeenCalledTimes(1);
    });

    it('does NOT start if DB has a RUNNING workflow_run', async () => {
      const { runner, repos, project, workflowService } = makeMocks();
      // Pre-create a RUNNING run in DB (simulating existing run from prior process)
      repos.workflowRunRepo.create(project.id);
      runner.run(project.id);
      await flush();
      expect(workflowService.startPipeline).not.toHaveBeenCalled();
    });

    it('allows a new run after previous completed', async () => {
      const { runner, project, workflowService } = makeMocks();
      runner.run(project.id);
      await flush();
      runner.run(project.id);
      await flush();
      expect(workflowService.startPipeline).toHaveBeenCalledTimes(2);
    });
  });

  describe('error handling', () => {
    it('sets workflow_run to FAILED on pipeline error', async () => {
      const { runner, repos, project } = makeMocks({ pipelineShouldFail: true });
      runner.run(project.id);
      await flush();
      const runs = repos.workflowRunRepo.findByProjectId(project.id);
      expect(runs[0]?.status).toBe('FAILED');
      expect(runs[0]?.error).toContain('pipeline failed');
    });

    it('sets project to FAILED on pipeline error', async () => {
      const { runner, repos, project } = makeMocks({ pipelineShouldFail: true });
      runner.run(project.id);
      await flush();
      expect(repos.projectRepo.findById(project.id)?.status).toBe('FAILED');
    });

    it('sends LINE push notification on pipeline error', async () => {
      const { runner, project, lineClient } = makeMocks({ pipelineShouldFail: true });
      runner.run(project.id);
      await flush();
      expect(lineClient.sendPush).toHaveBeenCalledWith(
        project.userId,
        expect.stringContaining('エラー')
      );
    });

    it('releases memory lock after pipeline error', async () => {
      const { runner, project, workflowService } = makeMocks({ pipelineShouldFail: true });
      runner.run(project.id);
      await flush();

      // Now fix the pipeline and run again - should be allowed
      (workflowService.startPipeline as jest.Mock).mockResolvedValueOnce(undefined);
      runner.run(project.id);
      await flush();
      expect(workflowService.startPipeline).toHaveBeenCalledTimes(2);
    });

    it('does NOT crash when LINE notification fails', async () => {
      const { runner, project, lineClient } = makeMocks({ pipelineShouldFail: true });
      (lineClient.sendPush as jest.Mock).mockRejectedValueOnce(new Error('LINE down'));

      await expect(async () => {
        runner.run(project.id);
        await flush();
      }).not.toThrow();
    });
  });
});
