import path from 'path';
import fs from 'fs';
import os from 'os';
import { WorkflowService } from '../../src/core/workflowService';
import { StateMachine } from '../../src/core/stateMachine';
import { AgentFactory } from '../../src/agents/AgentFactory';
import { WorkspaceService } from '../../src/core/workspaceService';
import { createTestDb, makeHearingAnswers } from '../helpers/testDb';
import { AgentResult, AgentContext } from '../../src/agents/Agent';

function buildService(overrides: {
  agentShouldFail?: boolean;
  stopAfterPhase?: string;
} = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-test-'));
  const repos = createTestDb();

  const project = repos.projectRepo.create({
    name: 'Test App',
    slug: `slug-${Date.now()}`,
    userId: 'U_test',
    workspacePath: path.join(tempRoot, 'project'),
  });
  repos.projectRepo.updateStatus(project.id, 'REQUIREMENTS');

  fs.mkdirSync(path.join(tempRoot, 'project', 'docs', 'revisions'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'project', 'src'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'project', 'tests'), { recursive: true });
  fs.mkdirSync(path.join(tempRoot, 'project', 'logs'), { recursive: true });

  makeHearingAnswers(repos, project.id);

  const pushMessages: Array<{ userId: string; text: string }> = [];
  const lineClient = {
    sendPush: jest.fn(async (userId: string, text: string) => {
      pushMessages.push({ userId, text });
    }),
  };

  const workspaceService = new WorkspaceService(tempRoot);

  // Mock AgentFactory that can simulate failures
  const agentFactory = new AgentFactory();
  if (overrides.agentShouldFail) {
    const original = agentFactory.getAgentForPhase.bind(agentFactory);
    jest.spyOn(agentFactory, 'getAgentForPhase').mockImplementation((phase: string) => {
      const agent = original(phase);
      return {
        ...agent,
        run: async (_ctx: AgentContext): Promise<AgentResult> => {
          throw new Error(`Agent ${phase} failed deliberately`);
        },
      };
    });
  }

  const service = new WorkflowService(
    repos.projectRepo,
    repos.taskRepo,
    repos.agentRepo,
    repos.documentRepo,
    repos.hearingAnswerRepo,
    workspaceService,
    lineClient as any,
    new StateMachine(),
    agentFactory,
  );

  return { service, repos, project, lineClient, pushMessages, tempRoot };
}

describe('WorkflowService.startPipeline', () => {
  let tempRoots: string[] = [];

  afterEach(() => {
    for (const r of tempRoots) {
      fs.rmSync(r, { recursive: true, force: true });
    }
    tempRoots = [];
  });

  describe('happy path – full pipeline', () => {
    it('transitions through all phases to WAITING_APPROVAL', async () => {
      const { service, repos, project, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.startPipeline(project.id, 'run-1');

      expect(repos.projectRepo.findById(project.id)?.status).toBe('WAITING_APPROVAL');
    });

    it('sends LINE notifications for each phase', async () => {
      const { service, repos, project, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.startPipeline(project.id, 'run-1');

      // Should have phase start + phase complete messages
      const texts = pushMessages.map((m) => m.text);
      expect(texts.some((t) => t.includes('要件定義'))).toBe(true);
      expect(texts.some((t) => t.includes('基本設計'))).toBe(true);
      expect(texts.some((t) => t.includes('テスト'))).toBe(true);
    });

    it('sends completion message to correct userId', async () => {
      const { service, repos, project, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.startPipeline(project.id, 'run-1');

      expect(pushMessages.every((m) => m.userId === 'U_test')).toBe(true);
    });

    it('generates docs/requirements.md in workspace', async () => {
      const { service, repos, project, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.startPipeline(project.id, 'run-1');

      const reqPath = path.join(project.workspacePath, 'docs', 'requirements.md');
      expect(fs.existsSync(reqPath)).toBe(true);
    });

    it('generates all three design docs', async () => {
      const { service, repos, project, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.startPipeline(project.id, 'run-1');

      const wp = project.workspacePath;
      expect(fs.existsSync(path.join(wp, 'docs', 'requirements.md'))).toBe(true);
      expect(fs.existsSync(path.join(wp, 'docs', 'basic-design.md'))).toBe(true);
      expect(fs.existsSync(path.join(wp, 'docs', 'detailed-design.md'))).toBe(true);
    });

    it('generates src/index.ts and src/app.ts', async () => {
      const { service, project, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.startPipeline(project.id, 'run-1');

      expect(fs.existsSync(path.join(project.workspacePath, 'src', 'index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(project.workspacePath, 'src', 'app.ts'))).toBe(true);
    });

    it('saves documents to DB', async () => {
      const { service, repos, project, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.startPipeline(project.id, 'run-1');

      const docs = repos.documentRepo.findByProjectId(project.id);
      expect(docs.length).toBeGreaterThan(0);
    });

    it('creates tasks for each phase in DB', async () => {
      const { service, repos, project, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.startPipeline(project.id, 'run-1');

      const tasks = repos.taskRepo.findByProjectId(project.id);
      expect(tasks.length).toBeGreaterThanOrEqual(6); // requirements through review
    });

    it('sends completion message with 承認/修正 instructions', async () => {
      const { service, pushMessages, project, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.startPipeline(project.id, 'run-1');

      const lastMsg = pushMessages[pushMessages.length - 1].text;
      expect(lastMsg).toContain('承認');
      expect(lastMsg).toContain('修正');
    });
  });

  describe('STOP mid-pipeline', () => {
    it('halts when project is STOPPED between phases', async () => {
      const repos = createTestDb();
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-stop-'));
      tempRoots.push(tempRoot);

      const project = repos.projectRepo.create({
        name: 'Stop Test', slug: `slug-stop-${Date.now()}`, userId: 'U_stop', workspacePath: path.join(tempRoot, 'project'),
      });
      fs.mkdirSync(path.join(tempRoot, 'project', 'docs', 'revisions'), { recursive: true });
      fs.mkdirSync(path.join(tempRoot, 'project', 'src'), { recursive: true });
      fs.mkdirSync(path.join(tempRoot, 'project', 'tests'), { recursive: true });
      fs.mkdirSync(path.join(tempRoot, 'project', 'logs'), { recursive: true });

      repos.projectRepo.updateStatus(project.id, 'REQUIREMENTS');
      makeHearingAnswers(repos, project.id);

      const lineClient = { sendPush: jest.fn().mockResolvedValue(undefined) };

      // Agent that stops the project mid-execution (after first phase)
      let callCount = 0;
      const agentFactory = new AgentFactory();
      jest.spyOn(agentFactory, 'getAgentForPhase').mockImplementation((phase: string) => ({
        name: phase,
        role: phase,
        run: async (ctx: AgentContext): Promise<AgentResult> => {
          callCount++;
          if (callCount === 1) {
            // Stop the project after first phase runs
            repos.projectRepo.updateStatus(ctx.project.id, 'STOPPED');
          }
          return { ok: true, summary: `phase ${phase} done` };
        },
      }));

      const service = new WorkflowService(
        repos.projectRepo, repos.taskRepo, repos.agentRepo, repos.documentRepo,
        repos.hearingAnswerRepo, new WorkspaceService(tempRoot),
        lineClient as any, new StateMachine(), agentFactory,
      );

      await service.startPipeline(project.id, 'run-1');

      // Pipeline should halt, not reach WAITING_APPROVAL
      expect(repos.projectRepo.findById(project.id)?.status).toBe('STOPPED');
      // Only first phase ran
      const tasks = repos.taskRepo.findByProjectId(project.id);
      expect(tasks.length).toBe(1);
    });
  });

  describe('error handling', () => {
    it('throws when agent throws', async () => {
      const { service, project, tempRoot } = buildService({ agentShouldFail: true });
      tempRoots.push(tempRoot);

      await expect(service.startPipeline(project.id, 'run-1')).rejects.toThrow();
    });

    it('throws when project not found', async () => {
      const { service, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await expect(service.startPipeline('non-existent-id', 'run-1')).rejects.toThrow('Project not found');
    });

    it('throws when hearing answers are missing', async () => {
      const repos = createTestDb();
      const project = repos.projectRepo.create({ name: 'P', slug: `s-${Date.now()}`, userId: 'U', workspacePath: '/tmp' });
      repos.projectRepo.updateStatus(project.id, 'REQUIREMENTS');
      // No hearing answers created

      const lineClient = { sendPush: jest.fn() };
      const service = new WorkflowService(
        repos.projectRepo, repos.taskRepo, repos.agentRepo, repos.documentRepo,
        repos.hearingAnswerRepo, new WorkspaceService(), lineClient as any,
        new StateMachine(), new AgentFactory(),
      );

      await expect(service.startPipeline(project.id, 'run-1')).rejects.toThrow('No hearing answers');
    });
  });
});
