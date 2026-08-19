import path from 'path';
import fs from 'fs';
import os from 'os';
import { ProjectService } from '../../src/core/projectService';
import { StateMachine } from '../../src/core/stateMachine';
import { AgentFactory } from '../../src/agents/AgentFactory';
import { WorkspaceService } from '../../src/core/workspaceService';
import { createTestDb, makeHearingAnswers } from '../helpers/testDb';

function makeClaudeCodeServiceMock() {
  return {
    runAnalyze: jest.fn().mockResolvedValue('分析結果テキスト'),
    runPlan: jest.fn().mockResolvedValue(undefined),
    handleConfirmOrRewrite: jest.fn().mockResolvedValue(undefined),
    hasPendingPlan: jest.fn().mockReturnValue(false),
    cancelPendingPlan: jest.fn().mockReturnValue(false),
  };
}

function buildServiceWithAI(aiResponse: string) {
  const base = buildService();
  const aiClient = { generate: jest.fn().mockResolvedValue(aiResponse) };
  const claudeCodeService = makeClaudeCodeServiceMock();
  const service = new ProjectService(
    base.repos.projectRepo,
    base.repos.messageRepo,
    base.repos.agentRepo,
    base.repos.approvalRepo,
    base.repos.webhookEventRepo,
    base.repos.hearingAnswerRepo,
    new (require('../../src/core/workspaceService').WorkspaceService)(base.tempRoot),
    base.workflowRunner as any,
    { startPipeline: jest.fn().mockResolvedValue(undefined) } as any,
    new (require('../../src/core/stateMachine').StateMachine)(),
    new (require('../../src/agents/AgentFactory').AgentFactory)(),
    base.lineClient as any,
    base.gitCommandService as any,
    base.editorService as any,
    aiClient as any,
    claudeCodeService as any,
  );
  return { ...base, service, aiClient, claudeCodeService };
}

function buildService() {
  const repos = createTestDb();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-test-'));
  const workspaceService = new WorkspaceService(tempRoot);
  const workflowRunner = { run: jest.fn() };
  const workflowService = { startPipeline: jest.fn().mockResolvedValue(undefined) };
  const pushMessages: Array<{ userId: string; text: string }> = [];
  const lineClient = {
    sendPush: jest.fn(async (userId: string, text: string) => {
      pushMessages.push({ userId, text });
    }),
  };
  const gitCommandService = {
    handleListRepos: jest.fn().mockResolvedValue(undefined),
    handleSelectRepo: jest.fn().mockResolvedValue(undefined),
    handleStatus: jest.fn().mockResolvedValue(undefined),
    handleLog: jest.fn().mockResolvedValue(undefined),
    handleFetch: jest.fn().mockResolvedValue(undefined),
    handlePull: jest.fn().mockResolvedValue(undefined),
    handlePush: jest.fn().mockResolvedValue(undefined),
    handleBranchList: jest.fn().mockResolvedValue(undefined),
    handleCheckout: jest.fn().mockResolvedValue(undefined),
    handleDiff: jest.fn().mockResolvedValue(undefined),
    handleConfirm: jest.fn().mockResolvedValue(undefined),
    handleCancel: jest.fn().mockResolvedValue(undefined),
    handleInit: jest.fn().mockResolvedValue(undefined),
    getSessionState: jest.fn().mockReturnValue({ selectedRepo: null, pendingAction: null }),
    invalidateCache: jest.fn(),
    runCommand: jest.fn().mockResolvedValue({ ok: true, stdout: '', stderr: '' }),
  };
  const editorService = {
    handleLaunch: jest.fn().mockResolvedValue(undefined),
    handleStatus: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ProjectService(
    repos.projectRepo,
    repos.messageRepo,
    repos.agentRepo,
    repos.approvalRepo,
    repos.webhookEventRepo,
    repos.hearingAnswerRepo,
    workspaceService,
    workflowRunner as any,
    workflowService as any,
    new StateMachine(),
    new AgentFactory(),
    lineClient as any,
    gitCommandService as any,
    editorService as any,
  );

  return { service, repos, lineClient, workflowRunner, pushMessages, tempRoot, gitCommandService, editorService };
}

describe('ProjectService', () => {
  let tempRoots: string[] = [];

  afterEach(() => {
    for (const r of tempRoots) {
      fs.rmSync(r, { recursive: true, force: true });
    }
    tempRoots = [];
  });

  // ─────────────────────────────────────────────────
  // handleNewProject
  // ─────────────────────────────────────────────────
  describe('handleNewProject (NEW_PROJECT)', () => {
    it('creates project with HEARING status', async () => {
      const { service, repos, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'My App', userId: 'U1', force: false });

      const project = repos.projectRepo.findActiveByUserId('U1');
      expect(project?.status).toBe('HEARING');
    });

    it('sends LINE push notification', async () => {
      const { service, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'My App', userId: 'U1', force: false });

      expect(pushMessages.length).toBeGreaterThan(0);
      expect(pushMessages[0].userId).toBe('U1');
    });

    it('creates workspace directory', async () => {
      const { service, repos, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'My App', userId: 'U1', force: false });

      const project = repos.projectRepo.findActiveByUserId('U1');
      expect(fs.existsSync(project!.workspacePath)).toBe(true);
    });

    it('sends warning and does NOT create when active project exists', async () => {
      const { service, repos, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'First App', userId: 'U2', force: false });
      const countBefore = repos.projectRepo.findByUserId('U2').length;
      pushMessages.length = 0;

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'Second App', userId: 'U2', force: false });

      const countAfter = repos.projectRepo.findByUserId('U2').length;
      expect(countAfter).toBe(countBefore); // no new project
      expect(pushMessages[0]?.text).toContain('強制作成');
    });
  });

  describe('handleNewProject (NEW_PROJECT_FORCE)', () => {
    it('stops existing project and creates new one', async () => {
      const { service, repos, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'Old App', userId: 'U3', force: false });
      const old = repos.projectRepo.findActiveByUserId('U3')!;

      await service.handleCommand({ type: 'NEW_PROJECT_FORCE', name: 'New App', userId: 'U3', force: true });

      const oldUpdated = repos.projectRepo.findById(old.id)!;
      expect(oldUpdated.status).toBe('STOPPED');
      expect(oldUpdated.isActive).toBe(0);

      const newProject = repos.projectRepo.findActiveByUserId('U3');
      expect(newProject?.name).toBe('New App');
    });

    it('creates new project even when no active project exists', async () => {
      const { service, repos, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT_FORCE', name: 'Fresh App', userId: 'U4', force: true });

      const project = repos.projectRepo.findActiveByUserId('U4');
      expect(project?.name).toBe('Fresh App');
      expect(project?.status).toBe('HEARING');
    });
  });

  // ─────────────────────────────────────────────────
  // handleHearingReply
  // ─────────────────────────────────────────────────
  describe('handleHearingReply (HEARING_REPLY)', () => {
    it('sends follow-up question when fields are missing', async () => {
      const { service, repos, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U5', force: false });
      pushMessages.length = 0;

      await service.handleCommand({ type: 'HEARING_REPLY', content: 'purpose: メモアプリ', userId: 'U5' });

      expect(pushMessages.length).toBeGreaterThan(0);
      expect(pushMessages[0]?.text).not.toContain('開発を開始します');
    });

    it('does NOT call workflowRunner when fields are missing', async () => {
      const { service, workflowRunner, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U5b', force: false });
      await service.handleCommand({ type: 'HEARING_REPLY', content: 'purpose: メモアプリ', userId: 'U5b' });

      expect(workflowRunner.run).not.toHaveBeenCalled();
    });

    it('starts pipeline when all fields are provided', async () => {
      const { service, repos, workflowRunner, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U6', force: false });
      pushMessages.length = 0;

      const fullReply = [
        'purpose: ToDoアプリ',
        'targetUsers: 一般ユーザー',
        'requiredFeatures: タスク追加・削除',
        'screens: あり',
        'techStack: React',
        'priority: 1ヶ月',
        'deployment: Vercel',
        'testScope: 単体テスト',
      ].join('\n');

      await service.handleCommand({ type: 'HEARING_REPLY', content: fullReply, userId: 'U6' });

      expect(workflowRunner.run).toHaveBeenCalledTimes(1);
      const project = repos.projectRepo.findById(
        repos.projectRepo.findByUserId('U6')[0].id
      );
      expect(project?.status).toBe('REQUIREMENTS');
    });

    it('sends "開発を開始します" when all fields provided', async () => {
      const { service, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U6b', force: false });
      pushMessages.length = 0;

      const fullReply = 'purpose: p\ntargetUsers: u\nrequiredFeatures: f\nscreens: あり\ntechStack: ts\npriority: 1m\ndeployment: AWS\ntestScope: unit';
      await service.handleCommand({ type: 'HEARING_REPLY', content: fullReply, userId: 'U6b' });

      expect(pushMessages.some((m) => m.text.includes('開発を開始します'))).toBe(true);
    });

    it('sends error message when no active HEARING project', async () => {
      const { service, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'HEARING_REPLY', content: 'some answer', userId: 'U7' });

      expect(pushMessages[0]?.text).toContain('ヒアリング中のプロジェクトがありません');
    });

    it('sends error when project is not in HEARING status', async () => {
      const { service, repos, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U8', force: false });
      const p = repos.projectRepo.findActiveByUserId('U8')!;
      repos.projectRepo.updateStatus(p.id, 'REQUIREMENTS');
      pushMessages.length = 0;

      await service.handleCommand({ type: 'HEARING_REPLY', content: 'some answer', userId: 'U8' });

      expect(pushMessages[0]?.text).toContain('ヒアリング中のプロジェクトがありません');
    });
  });

  // ─────────────────────────────────────────────────
  // handleApprove
  // ─────────────────────────────────────────────────
  describe('handleApprove (APPROVE)', () => {
    it('completes project when in WAITING_APPROVAL', async () => {
      const { service, repos, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U9', force: false });
      const p = repos.projectRepo.findActiveByUserId('U9')!;
      repos.projectRepo.updateStatus(p.id, 'WAITING_APPROVAL');

      await service.handleCommand({ type: 'APPROVE', userId: 'U9' });

      const updated = repos.projectRepo.findById(p.id)!;
      expect(updated.status).toBe('COMPLETED');
      expect(updated.isActive).toBe(0);
    });

    it('sends completion message', async () => {
      const { service, repos, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'MyApp', userId: 'U9b', force: false });
      const p = repos.projectRepo.findActiveByUserId('U9b')!;
      repos.projectRepo.updateStatus(p.id, 'WAITING_APPROVAL');
      pushMessages.length = 0;

      await service.handleCommand({ type: 'APPROVE', userId: 'U9b' });

      expect(pushMessages[0]?.text).toContain('完了');
    });

    it('sends error when status is not WAITING_APPROVAL', async () => {
      const { service, repos, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U10', force: false });
      pushMessages.length = 0;

      await service.handleCommand({ type: 'APPROVE', userId: 'U10' });

      expect(pushMessages[0]?.text).toContain('承認できません');
    });

    it('sends error when no active project', async () => {
      const { service, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'APPROVE', userId: 'U11' });

      expect(pushMessages[0]?.text).toContain('プロジェクトがありません');
    });

    it('records approval in DB', async () => {
      const { service, repos, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U9c', force: false });
      const p = repos.projectRepo.findActiveByUserId('U9c')!;
      repos.projectRepo.updateStatus(p.id, 'WAITING_APPROVAL');

      await service.handleCommand({ type: 'APPROVE', userId: 'U9c' });

      const approvals = repos.approvalRepo.findByProjectId(p.id);
      expect(approvals.length).toBe(1);
      expect(approvals[0].status).toBe('APPROVED');
    });
  });

  // ─────────────────────────────────────────────────
  // handleModify
  // ─────────────────────────────────────────────────
  describe('handleModify (MODIFY)', () => {
    it('creates revision file from WAITING_APPROVAL', async () => {
      const { service, repos, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U12', force: false });
      const p = repos.projectRepo.findActiveByUserId('U12')!;
      repos.projectRepo.updateStatus(p.id, 'WAITING_APPROVAL');
      makeHearingAnswers(repos, p.id);

      await service.handleCommand({ type: 'MODIFY', content: 'ログイン機能を追加', userId: 'U12' });

      const revPath = path.join(p.workspacePath, 'docs', 'revisions', 'revision-1.md');
      expect(fs.existsSync(revPath)).toBe(true);
    });

    it('preserves hearing_answers during modify', async () => {
      const { service, repos, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U13', force: false });
      const p = repos.projectRepo.findActiveByUserId('U13')!;
      repos.projectRepo.updateStatus(p.id, 'WAITING_APPROVAL');
      makeHearingAnswers(repos, p.id);

      await service.handleCommand({ type: 'MODIFY', content: 'ログイン機能を追加', userId: 'U13' });

      const answers = repos.hearingAnswerRepo.findByProjectId(p.id);
      expect(answers).toBeDefined();
      expect(answers?.purpose).toBe('ToDoリスト管理アプリ');
    });

    it('calls workflowRunner.run after modify', async () => {
      const { service, repos, workflowRunner, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U14', force: false });
      const p = repos.projectRepo.findActiveByUserId('U14')!;
      repos.projectRepo.updateStatus(p.id, 'WAITING_APPROVAL');
      makeHearingAnswers(repos, p.id);

      await service.handleCommand({ type: 'MODIFY', content: 'add feature', userId: 'U14' });

      expect(workflowRunner.run).toHaveBeenCalledWith(p.id);
    });

    it('increments revisionNumber', async () => {
      const { service, repos, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U15', force: false });
      const p = repos.projectRepo.findActiveByUserId('U15')!;
      repos.projectRepo.updateStatus(p.id, 'WAITING_APPROVAL');
      makeHearingAnswers(repos, p.id);

      await service.handleCommand({ type: 'MODIFY', content: 'mod 1', userId: 'U15' });
      // reset back to WAITING_APPROVAL so second modify is allowed
      repos.projectRepo.updateStatus(p.id, 'WAITING_APPROVAL');
      await service.handleCommand({ type: 'MODIFY', content: 'mod 2', userId: 'U15' });

      expect(repos.projectRepo.findById(p.id)?.revisionNumber).toBe(2);
    });

    it('reactivates COMPLETED project on modify', async () => {
      const { service, repos, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U16', force: false });
      const p = repos.projectRepo.findActiveByUserId('U16')!;
      repos.projectRepo.setCompleted(p.id);
      makeHearingAnswers(repos, p.id);

      await service.handleCommand({ type: 'MODIFY', content: 'change something', userId: 'U16' });

      expect(repos.projectRepo.findById(p.id)?.isActive).toBe(1);
    });

    it('sends error when no modifiable project', async () => {
      const { service, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'MODIFY', content: 'something', userId: 'U17' });

      expect(pushMessages[0]?.text).toContain('修正できるプロジェクトがありません');
    });

    it('sends error when project is in invalid status (e.g. HEARING)', async () => {
      const { service, repos, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U18', force: false });
      // Status is HEARING — not in WAITING_APPROVAL or COMPLETED, so modify is refused
      pushMessages.length = 0;

      await service.handleCommand({ type: 'MODIFY', content: 'change', userId: 'U18' });

      // Implementation sends "現在は修正できません" because the active project exists but can't be modified
      expect(pushMessages[0]?.text).toContain('修正できません');
    });
  });

  // ─────────────────────────────────────────────────
  // handleStop
  // ─────────────────────────────────────────────────
  describe('handleStop (STOP)', () => {
    it('sets project to STOPPED and saves previousStatus', async () => {
      const { service, repos, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U19', force: false });
      const p = repos.projectRepo.findActiveByUserId('U19')!;

      await service.handleCommand({ type: 'STOP', userId: 'U19' });

      const updated = repos.projectRepo.findById(p.id)!;
      expect(updated.status).toBe('STOPPED');
      expect(updated.previousStatus).toBe('HEARING');
    });

    it('sends stop confirmation message', async () => {
      const { service, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U19b', force: false });
      pushMessages.length = 0;

      await service.handleCommand({ type: 'STOP', userId: 'U19b' });

      expect(pushMessages[0]?.text).toContain('停止');
    });

    it('sends error when no active project', async () => {
      const { service, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'STOP', userId: 'U20' });

      expect(pushMessages[0]?.text).toContain('停止できるプロジェクトがありません');
    });

    it('sends error when project is already STOPPED', async () => {
      const { service, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U20b', force: false });
      await service.handleCommand({ type: 'STOP', userId: 'U20b' }); // first stop
      pushMessages.length = 0;

      await service.handleCommand({ type: 'STOP', userId: 'U20b' }); // stop again

      // STOPPED project is still found by findActiveByUserId, but canStop(STOPPED) is false
      expect(pushMessages[0]?.text).toContain('停止できません');
    });
  });

  // ─────────────────────────────────────────────────
  // handleResume
  // ─────────────────────────────────────────────────
  describe('handleResume (RESUME)', () => {
    it('resumes project to previousStatus', async () => {
      const { service, repos, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U21', force: false });
      const p = repos.projectRepo.findActiveByUserId('U21')!;
      repos.projectRepo.updateStatus(p.id, 'REQUIREMENTS');
      await service.handleCommand({ type: 'STOP', userId: 'U21' });

      await service.handleCommand({ type: 'RESUME', userId: 'U21' });

      const updated = repos.projectRepo.findById(p.id)!;
      expect(updated.status).toBe('REQUIREMENTS');
    });

    it('calls workflowRunner.run after resume (non-HEARING status)', async () => {
      const { service, repos, workflowRunner, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U22', force: false });
      const p = repos.projectRepo.findActiveByUserId('U22')!;
      repos.projectRepo.updateStatus(p.id, 'REQUIREMENTS');
      await service.handleCommand({ type: 'STOP', userId: 'U22' });
      workflowRunner.run.mockClear();

      await service.handleCommand({ type: 'RESUME', userId: 'U22' });

      expect(workflowRunner.run).toHaveBeenCalledWith(p.id);
    });

    it('does NOT call workflowRunner when resumed to HEARING', async () => {
      const { service, repos, workflowRunner, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U23', force: false });
      // HEARING is the initial status; stop immediately
      await service.handleCommand({ type: 'STOP', userId: 'U23' });
      workflowRunner.run.mockClear();

      await service.handleCommand({ type: 'RESUME', userId: 'U23' });

      expect(workflowRunner.run).not.toHaveBeenCalled();
    });

    it('sends error when no stopped project', async () => {
      const { service, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'RESUME', userId: 'U24' });

      expect(pushMessages[0]?.text).toContain('再開できるプロジェクトがありません');
    });

    it('clears previousStatus after resume', async () => {
      const { service, repos, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U25', force: false });
      await service.handleCommand({ type: 'STOP', userId: 'U25' });
      const p = repos.projectRepo.findByUserId('U25')[0];

      await service.handleCommand({ type: 'RESUME', userId: 'U25' });

      expect(repos.projectRepo.findById(p.id)?.previousStatus).toBeNull();
    });
  });

  // ─────────────────────────────────────────────────
  // handleProgress
  // ─────────────────────────────────────────────────
  describe('handleProgress (PROGRESS)', () => {
    it('sends project status when active project exists', async () => {
      const { service, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'My Cool App', userId: 'U26', force: false });
      pushMessages.length = 0;

      await service.handleCommand({ type: 'PROGRESS', userId: 'U26' });

      const text = pushMessages[0]?.text ?? '';
      expect(text).toContain('My Cool App');
      expect(text).toContain('HEARING');
    });

    it('sends "no project" message when no active project', async () => {
      const { service, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'PROGRESS', userId: 'U27' });

      expect(pushMessages[0]?.text).toContain('プロジェクトはありません');
    });

    it('includes missing hearing fields in HEARING status', async () => {
      const { service, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'U28', force: false });
      pushMessages.length = 0;

      await service.handleCommand({ type: 'PROGRESS', userId: 'U28' });

      // Should mention missing fields
      expect(pushMessages[0]?.text).toContain('未回答項目');
    });
  });

  // ─────────────────────────────────────────────────
  // handleWebhookEvent (deduplication)
  // ─────────────────────────────────────────────────
  describe('handleWebhookEvent', () => {
    it('returns isDuplicate=false for new event', async () => {
      const { service, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      const event = {
        type: 'message' as const,
        source: { type: 'user' as const, userId: 'U29' },
        message: { id: 'msg-1', type: 'text' as const, text: 'hello' },
        timestamp: Date.now(),
        deliveryContext: { isRedelivery: false },
      };

      const result = await service.handleWebhookEvent(event, 'evt-001');
      expect(result.isDuplicate).toBe(false);
    });

    it('returns isDuplicate=true for duplicate event', async () => {
      const { service, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      const event = {
        type: 'message' as const,
        source: { type: 'user' as const, userId: 'U30' },
        message: { id: 'msg-2', type: 'text' as const, text: 'hello' },
        timestamp: Date.now(),
        deliveryContext: { isRedelivery: true },
      };

      await service.handleWebhookEvent(event, 'evt-002');
      const result = await service.handleWebhookEvent(event, 'evt-002');
      expect(result.isDuplicate).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────
  // handleUnknown — no AI client (fallback)
  // ─────────────────────────────────────────────────
  describe('handleUnknown (UNKNOWN) — no AI', () => {
    it('sends command list when no aiClient', async () => {
      const { service, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: 'gibberish', userId: 'U31' });

      const text = pushMessages[0]?.text ?? '';
      expect(text).toContain('新規プロジェクト');
      expect(text).toContain('承認');
    });
  });

  // ─────────────────────────────────────────────────
  // handleWithAIClassification — happy path
  // ─────────────────────────────────────────────────
  describe('handleWithAIClassification — happy path', () => {
    it('routes GIT_LIST_REPOS via AI classification', async () => {
      const { service, gitCommandService, tempRoot } = buildServiceWithAI('{"type":"GIT_LIST_REPOS"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: 'リポジトリの一覧を教えてください', userId: 'Uai1' });
      expect(gitCommandService.handleListRepos).toHaveBeenCalledWith('Uai1');
    });

    it('routes GIT_STATUS via AI classification', async () => {
      const { service, gitCommandService, tempRoot } = buildServiceWithAI('{"type":"GIT_STATUS"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: '今の状態を教えて', userId: 'Uai2' });
      expect(gitCommandService.handleStatus).toHaveBeenCalledWith('Uai2');
    });

    it('routes GIT_SELECT_REPO with query via AI classification', async () => {
      const { service, gitCommandService, tempRoot } = buildServiceWithAI('{"type":"GIT_SELECT_REPO","query":"Creancora"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: 'Creancora を開きたい', userId: 'Uai3' });
      expect(gitCommandService.handleSelectRepo).toHaveBeenCalledWith('Creancora', 'Uai3');
    });

    it('routes GIT_CHECKOUT with branch via AI classification', async () => {
      const { service, gitCommandService, tempRoot } = buildServiceWithAI('{"type":"GIT_CHECKOUT","branch":"feature/login"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: 'feature/login ブランチに切り替えたい', userId: 'Uai4' });
      expect(gitCommandService.handleCheckout).toHaveBeenCalledWith('feature/login', 'Uai4');
    });

    it('routes EDITOR_OPEN with editorHint via AI classification', async () => {
      const { service, editorService, tempRoot } = buildServiceWithAI('{"type":"EDITOR_OPEN","editorHint":"VSCode"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: 'VSCodeを開いてほしい', userId: 'Uai5' });
      expect(editorService.handleLaunch).toHaveBeenCalledWith('Uai5', undefined, 'VSCode');
    });

    it('routes EDITOR_OPEN with null editorHint via AI classification', async () => {
      const { service, editorService, tempRoot } = buildServiceWithAI('{"type":"EDITOR_OPEN","editorHint":null}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: 'エディター開いて', userId: 'Uai5b' });
      expect(editorService.handleLaunch).toHaveBeenCalledWith('Uai5b', undefined, undefined);
    });

    it('routes GIT_PULL via AI classification', async () => {
      const { service, gitCommandService, tempRoot } = buildServiceWithAI('{"type":"GIT_PULL"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: '最新を取得してほしい', userId: 'Uai6' });
      expect(gitCommandService.handlePull).toHaveBeenCalledWith('Uai6');
    });

    it('routes GIT_PUSH via AI classification', async () => {
      const { service, gitCommandService, tempRoot } = buildServiceWithAI('{"type":"GIT_PUSH"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: '変更をpushしたい', userId: 'Uai7' });
      expect(gitCommandService.handlePush).toHaveBeenCalledWith('Uai7');
    });

    it('routes GIT_FETCH via AI classification', async () => {
      const { service, gitCommandService, tempRoot } = buildServiceWithAI('{"type":"GIT_FETCH"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: 'フェッチしてください', userId: 'Uai8' });
      expect(gitCommandService.handleFetch).toHaveBeenCalledWith('Uai8');
    });

    it('routes GIT_BRANCH_LIST via AI classification', async () => {
      const { service, gitCommandService, tempRoot } = buildServiceWithAI('{"type":"GIT_BRANCH_LIST"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: 'ブランチの種類を教えて', userId: 'Uai9' });
      expect(gitCommandService.handleBranchList).toHaveBeenCalledWith('Uai9');
    });

    it('routes GIT_DIFF via AI classification', async () => {
      const { service, gitCommandService, tempRoot } = buildServiceWithAI('{"type":"GIT_DIFF"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: '変更点を見せて', userId: 'Uai10' });
      expect(gitCommandService.handleDiff).toHaveBeenCalledWith('Uai10');
    });

    it('routes CONFIG_SHOW via AI classification', async () => {
      const { service, pushMessages, tempRoot } = buildServiceWithAI('{"type":"CONFIG_SHOW"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: '設定を見せて', userId: 'Uai11' });
      expect(pushMessages.some((m) => m.text.includes('設定'))).toBe(true);
    });

    it('routes PROGRESS via AI classification', async () => {
      const { service, pushMessages, tempRoot } = buildServiceWithAI('{"type":"PROGRESS"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: '進行状況を教えて', userId: 'Uai12' });
      expect(pushMessages.some((m) => m.text.includes('プロジェクトはありません') || m.text.includes('プロジェクト'))).toBe(true);
    });

    it('sends NONE response when AI classifies as general conversation', async () => {
      const { service, pushMessages, tempRoot } = buildServiceWithAI('{"type":"NONE","response":"こんにちは！お手伝いします。"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: 'こんにちは', userId: 'Uai13' });
      expect(pushMessages[0]?.text).toBe('こんにちは！お手伝いします。');
    });

    it('truncates NONE response at 4500 chars', async () => {
      const longResponse = 'あ'.repeat(5000);
      const { service, pushMessages, tempRoot } = buildServiceWithAI(`{"type":"NONE","response":"${longResponse}"}`);
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: '何か', userId: 'Uai14' });
      expect(pushMessages[0]!.text.length).toBe(4500);
    });
  });

  // ─────────────────────────────────────────────────
  // handleWithAIClassification — edge cases
  // ─────────────────────────────────────────────────
  describe('handleWithAIClassification — edge cases', () => {
    it('falls back to command list when AI returns invalid JSON', async () => {
      const { service, pushMessages, tempRoot } = buildServiceWithAI('これはJSONではありません');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: '何か', userId: 'Uedge1' });
      expect(pushMessages[0]?.text).toContain('新規プロジェクト');
    });

    it('falls back when AI returns unknown command type', async () => {
      const { service, pushMessages, tempRoot } = buildServiceWithAI('{"type":"DOES_NOT_EXIST"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: '何か', userId: 'Uedge2' });
      expect(pushMessages[0]?.text).toContain('新規プロジェクト');
    });

    it('falls back when AI throws an error', async () => {
      const base = buildService();
      tempRoots.push(base.tempRoot);
      const aiClient = { generate: jest.fn().mockRejectedValue(new Error('API error')) };
      const { ProjectService: PS } = require('../../src/core/projectService');
      const service = new PS(
        base.repos.projectRepo, base.repos.messageRepo, base.repos.agentRepo,
        base.repos.approvalRepo, base.repos.webhookEventRepo, base.repos.hearingAnswerRepo,
        new (require('../../src/core/workspaceService').WorkspaceService)(base.tempRoot),
        base.workflowRunner as any,
        { startPipeline: jest.fn().mockResolvedValue(undefined) } as any,
        new (require('../../src/core/stateMachine').StateMachine)(),
        new (require('../../src/agents/AgentFactory').AgentFactory)(),
        base.lineClient as any,
        base.gitCommandService as any,
        base.editorService as any,
        aiClient as any,
      );

      await service.handleCommand({ type: 'UNKNOWN', raw: '何か', userId: 'Uedge3' });
      expect(base.pushMessages[0]?.text).toContain('新規プロジェクト');
    });

    it('strips markdown code fences from AI JSON response', async () => {
      const { service, gitCommandService, tempRoot } = buildServiceWithAI(
        '```json\n{"type":"GIT_LIST_REPOS"}\n```'
      );
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: 'リポジトリ見せて', userId: 'Uedge4' });
      expect(gitCommandService.handleListRepos).toHaveBeenCalledWith('Uedge4');
    });

    it('handles NONE with no response field gracefully', async () => {
      const { service, pushMessages, tempRoot } = buildServiceWithAI('{"type":"NONE"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: '何か', userId: 'Uedge5' });
      expect(pushMessages.length).toBe(0);
    });

    it('handles GIT_SELECT_REPO with empty query gracefully', async () => {
      const { service, gitCommandService, tempRoot } = buildServiceWithAI('{"type":"GIT_SELECT_REPO"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: 'リポジトリを選んで', userId: 'Uedge6' });
      expect(gitCommandService.handleSelectRepo).toHaveBeenCalledWith('', 'Uedge6');
    });

    it('handles GIT_CHECKOUT with empty branch gracefully', async () => {
      const { service, gitCommandService, tempRoot } = buildServiceWithAI('{"type":"GIT_CHECKOUT"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: 'ブランチ変えて', userId: 'Uedge7' });
      expect(gitCommandService.handleCheckout).toHaveBeenCalledWith('', 'Uedge7');
    });
  });

  // ─────────────────────────────────────────────────
  // git command routing
  // ─────────────────────────────────────────────────
  describe('git command routing', () => {
    it('routes GIT_LIST_REPOS to gitCommandService', async () => {
      const { service, gitCommandService, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'GIT_LIST_REPOS', userId: 'Ug1' });
      expect(gitCommandService.handleListRepos).toHaveBeenCalledWith('Ug1');
    });

    it('routes GIT_STATUS to gitCommandService', async () => {
      const { service, gitCommandService, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'GIT_STATUS', userId: 'Ug2' });
      expect(gitCommandService.handleStatus).toHaveBeenCalledWith('Ug2');
    });

    it('routes GIT_PUSH to gitCommandService', async () => {
      const { service, gitCommandService, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'GIT_PUSH', userId: 'Ug3' });
      expect(gitCommandService.handlePush).toHaveBeenCalledWith('Ug3');
    });

    it('routes GIT_CHECKOUT with branch to gitCommandService', async () => {
      const { service, gitCommandService, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'GIT_CHECKOUT', branch: 'feature/x', userId: 'Ug4' });
      expect(gitCommandService.handleCheckout).toHaveBeenCalledWith('feature/x', 'Ug4');
    });

    it('routes GIT_CONFIRM to gitCommandService', async () => {
      const { service, gitCommandService, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'GIT_CONFIRM', userId: 'Ug5' });
      expect(gitCommandService.handleConfirm).toHaveBeenCalledWith('Ug5');
    });
  });

  // ─────────────────────────────────────────────────
  // editor command routing
  // ─────────────────────────────────────────────────
  describe('editor command routing', () => {
    it('routes EDITOR_OPEN to editorService.handleLaunch', async () => {
      const { service, editorService, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'EDITOR_OPEN', editorHint: 'VSCode', userId: 'Ue1' });
      expect(editorService.handleLaunch).toHaveBeenCalledWith('Ue1', undefined, 'VSCode');
    });

    it('routes EDITOR_OPEN with null hint', async () => {
      const { service, editorService, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'EDITOR_OPEN', editorHint: null, userId: 'Ue2' });
      expect(editorService.handleLaunch).toHaveBeenCalledWith('Ue2', undefined, undefined);
    });

    it('routes EDITOR_STATUS to editorService.handleStatus', async () => {
      const { service, editorService, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'EDITOR_STATUS', userId: 'Ue3' });
      expect(editorService.handleStatus).toHaveBeenCalledWith('Ue3');
    });
  });

  // ─────────────────────────────────────────────────
  // GIT_INIT routing
  // ─────────────────────────────────────────────────
  describe('GIT_INIT routing', () => {
    it('routes GIT_INIT to gitCommandService.handleInit', async () => {
      const { service, gitCommandService, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'GIT_INIT', name: 'my-repo', userId: 'Ugit1' });
      expect(gitCommandService.handleInit).toHaveBeenCalledWith('my-repo', 'Ugit1');
    });

    it('routes GIT_INIT via AI classification', async () => {
      const { service, gitCommandService, tempRoot } = buildServiceWithAI('{"type":"GIT_INIT","name":"creator-ai-promo"}');
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: 'creator-ai-promoというリポジトリを作ってほしい', userId: 'Ugit2' });
      expect(gitCommandService.handleInit).toHaveBeenCalledWith('creator-ai-promo', 'Ugit2');
    });
  });

  // ─────────────────────────────────────────────────
  // TEAM_PROPOSE — dynamic team composition
  // ─────────────────────────────────────────────────
  describe('TEAM_PROPOSE — dynamic team composition', () => {
    it('sends default team proposal when no aiClient', async () => {
      const { service, pushMessages, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'TEAM_PROPOSE', description: '', userId: 'Uteam1' });
      const text = pushMessages[0]?.text ?? '';
      expect(text).toContain('チーム構成');
      expect(text).toContain('新規プロジェクト');
    });

    it('routes TEAM_PROPOSE via AI classification', async () => {
      const aiTeam = JSON.stringify([
        { name: '山田 Manager', role: 'プロジェクトマネージャー（窓口担当）' },
        { name: '佐藤 Engineer', role: '実装担当' },
      ]);
      const { service, pushMessages, tempRoot } = buildServiceWithAI(aiTeam);
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'UNKNOWN', raw: 'チームを提案してほしい', userId: 'Uteam2' });
      // AI response is a team JSON array → TEAM_PROPOSE falls back to default since type field missing
      // The AI call goes through TEAM_PROPOSE path via classify
      expect(pushMessages.length).toBeGreaterThan(0);
    });

    it('uses pending team when NEW_PROJECT follows TEAM_PROPOSE', async () => {
      const aiTeam = JSON.stringify([
        { name: '山田 Manager', role: '窓口担当' },
        { name: '佐藤 Dev', role: '開発担当' },
      ]);
      const { service, pushMessages, repos, tempRoot } = buildServiceWithAI(aiTeam);
      tempRoots.push(tempRoot);

      // Propose team (AI returns team JSON — no "type" field, so falls back to default)
      await service.handleCommand({ type: 'TEAM_PROPOSE', description: 'クリエイターAIツール', userId: 'Uteam3' });

      // Now create a project — should use default team since AI response had no "type"
      await service.handleCommand({ type: 'NEW_PROJECT', name: 'creator-ai-promo', userId: 'Uteam3', force: false });
      const project = repos.projectRepo.findActiveByUserId('Uteam3');
      expect(project).not.toBeNull();
      expect(project?.name).toBe('creator-ai-promo');
      // Project was created with pending team
      expect(pushMessages.some((m) => m.text.includes('creator-ai-promo'))).toBe(true);
    });

    it('NEW_PROJECT with AI-generated custom team stores correct member names', async () => {
      const aiTeam = JSON.stringify([
        { name: '田中 Coordinator', role: 'プロジェクトマネージャー（窓口担当）' },
        { name: '鈴木 Analyst', role: '要件定義担当' },
        { name: '佐藤 Developer', role: '実装担当' },
      ]);
      // Build service that returns the team JSON from AI
      const base = buildService();
      tempRoots.push(base.tempRoot);
      const { ProjectService: PS } = require('../../src/core/projectService');
      const aiClient = { generate: jest.fn().mockResolvedValue(aiTeam) };
      const service = new PS(
        base.repos.projectRepo, base.repos.messageRepo, base.repos.agentRepo,
        base.repos.approvalRepo, base.repos.webhookEventRepo, base.repos.hearingAnswerRepo,
        new (require('../../src/core/workspaceService').WorkspaceService)(base.tempRoot),
        base.workflowRunner as any,
        { startPipeline: jest.fn().mockResolvedValue(undefined) } as any,
        new (require('../../src/core/stateMachine').StateMachine)(),
        new (require('../../src/agents/AgentFactory').AgentFactory)(),
        base.lineClient as any,
        base.gitCommandService as any,
        base.editorService as any,
        aiClient as any,
      );

      // Propose team
      await service.handleCommand({ type: 'TEAM_PROPOSE', description: 'AI宣伝ツール', userId: 'Uteam4' });

      // Create project — should use the proposed team
      await service.handleCommand({ type: 'NEW_PROJECT', name: 'ai-promo', userId: 'Uteam4', force: false });
      const project = base.repos.projectRepo.findActiveByUserId('Uteam4');
      expect(project).not.toBeNull();
      // Agent records should reflect custom team names
      const agents = base.repos.agentRepo.findByProjectId(project!.id);
      const names = agents.map((a: { name: string }) => a.name);
      expect(names).toContain('田中 Coordinator');
      expect(names).toContain('佐藤 Developer');
    });
  });

  // ─────────────────────────────────────────────────
  // Claude Code CLI routing (REPO_ANALYZE / CLAUDE_PLAN / FEEDBACK)
  // ─────────────────────────────────────────────────
  describe('Claude Code CLI routing', () => {
    it('routes REPO_ANALYZE to claudeCodeService.runAnalyze', async () => {
      const { service, gitCommandService, claudeCodeService, tempRoot } =
        buildServiceWithAI('{"type":"REPO_ANALYZE","query":"リリース準備状況を確認して"}');
      tempRoots.push(tempRoot);
      // getRepoPath() は selectedRepo の末尾 (path) を抽出する
      gitCommandService.getSessionState.mockReturnValue({
        selectedRepo: 'MyRepo (C:\\repos\\MyRepo)',
        pendingAction: null,
      });

      await service.handleCommand({ type: 'UNKNOWN', raw: 'リリース準備を確認して', userId: 'Ucc1' });

      expect(claudeCodeService.runAnalyze).toHaveBeenCalledWith(
        'C:\\repos\\MyRepo',
        'リリース準備状況を確認して',
        'Ucc1',
      );
    });

    it('routes CLAUDE_PLAN to claudeCodeService.runPlan with (repoPath, prompt, userId)', async () => {
      const { service, gitCommandService, claudeCodeService, tempRoot } =
        buildServiceWithAI('{"type":"CLAUDE_PLAN","prompt":"ログイン画面のバリデーションを修正して"}');
      tempRoots.push(tempRoot);
      gitCommandService.getSessionState.mockReturnValue({
        selectedRepo: 'MyRepo (C:\\repos\\MyRepo)',
        pendingAction: null,
      });

      await service.handleCommand({ type: 'UNKNOWN', raw: 'ログイン画面を直して', userId: 'Ucc2' });

      expect(claudeCodeService.runPlan).toHaveBeenCalledWith(
        'C:\\repos\\MyRepo',
        'ログイン画面のバリデーションを修正して',
        'Ucc2',
      );
    });

    it('routes FEEDBACK to claudeCodeService.runPlan without a 4th argument', async () => {
      const { service, claudeCodeService, tempRoot } =
        buildServiceWithAI('{"type":"FEEDBACK","description":"想定外の返答が返ってきた"}');
      tempRoots.push(tempRoot);
      // handleFeedback は selfRepoPath に package.json が実在することを要求する。
      // プロジェクトルート（cwd）には package.json があるため SELF_REPO_PATH に設定する。
      const prev = process.env['SELF_REPO_PATH'];
      process.env['SELF_REPO_PATH'] = process.cwd();
      try {
        await service.handleCommand({ type: 'UNKNOWN', raw: 'この返答は想定外', userId: 'Ucc3' });
      } finally {
        if (prev === undefined) delete process.env['SELF_REPO_PATH'];
        else process.env['SELF_REPO_PATH'] = prev;
      }

      expect(claudeCodeService.runPlan).toHaveBeenCalledTimes(1);
      expect(claudeCodeService.runPlan).toHaveBeenCalledWith(
        process.cwd(),
        expect.any(String),
        'Ucc3',
      );
      // 第4引数（旧 { allowExec } オプション）は渡さない
      expect(claudeCodeService.runPlan.mock.calls[0].length).toBe(3);
    });
  });

  // ─────────────────────────────────────────────────
  // getUserProjectStatus
  // ─────────────────────────────────────────────────
  describe('getUserProjectStatus', () => {
    it('returns status of active project', async () => {
      const { service, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'Us1', force: false });
      expect(service.getUserProjectStatus('Us1')).toBe('HEARING');
    });

    it('returns null when no active project', () => {
      const { service, tempRoot } = buildService();
      tempRoots.push(tempRoot);

      expect(service.getUserProjectStatus('no-such-user')).toBeNull();
    });
  });
});
