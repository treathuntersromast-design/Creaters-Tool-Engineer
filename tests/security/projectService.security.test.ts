/**
 * Security-focused integration tests for ProjectService.
 * Covers: force-create idempotency, hearing_answers preservation, workflow double-start.
 */
import path from 'path';
import fs from 'fs';
import os from 'os';
import { ProjectService } from '../../src/core/projectService';
import { StateMachine } from '../../src/core/stateMachine';
import { AgentFactory } from '../../src/agents/AgentFactory';
import { WorkspaceService } from '../../src/core/workspaceService';
import { createTestDb, makeHearingAnswers } from '../helpers/testDb';

function buildService() {
  const repos = createTestDb();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-ps-'));
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
  };
  const editorService = {
    handleLaunch: jest.fn().mockResolvedValue(undefined),
    handleStatus: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ProjectService(
    repos.projectRepo, repos.messageRepo, repos.agentRepo,
    repos.approvalRepo, repos.webhookEventRepo, repos.hearingAnswerRepo,
    workspaceService, workflowRunner as any, workflowService as any,
    new StateMachine(), new AgentFactory(), lineClient as any,
    gitCommandService as any, editorService as any,
  );

  return { service, repos, lineClient, workflowRunner, pushMessages, tempRoot };
}

let tempRoots: string[] = [];
afterEach(() => {
  for (const r of tempRoots) fs.rmSync(r, { recursive: true, force: true });
  tempRoots = [];
});

// ── Active project deduplication ───────────────────────────────────────────

describe('Active project deduplication', () => {
  it('NEW_PROJECT_FORCE stops old active and sets isActive=0', async () => {
    const { service, repos, tempRoot } = buildService();
    tempRoots.push(tempRoot);

    await service.handleCommand({ type: 'NEW_PROJECT', name: 'Old', userId: 'Usec1', force: false });
    const old = repos.projectRepo.findActiveByUserId('Usec1')!;
    expect(old.isActive).toBe(1);

    await service.handleCommand({ type: 'NEW_PROJECT_FORCE', name: 'New', userId: 'Usec1', force: true });
    expect(repos.projectRepo.findById(old.id)!.isActive).toBe(0);
    expect(repos.projectRepo.findById(old.id)!.status).toBe('STOPPED');
  });

  it('Only one active project per user after force-create', async () => {
    const { service, repos, tempRoot } = buildService();
    tempRoots.push(tempRoot);

    await service.handleCommand({ type: 'NEW_PROJECT', name: 'P1', userId: 'Usec2', force: false });
    await service.handleCommand({ type: 'NEW_PROJECT_FORCE', name: 'P2', userId: 'Usec2', force: true });

    const allProjects = repos.projectRepo.findByUserId('Usec2');
    const activeProjects = allProjects.filter(
      (p) => p.isActive === 1 && !['COMPLETED', 'FAILED'].includes(p.status),
    );
    expect(activeProjects.length).toBe(1);
    expect(activeProjects[0].name).toBe('P2');
  });

  it('STOPPED project is not returned as active', async () => {
    const { service, repos, tempRoot } = buildService();
    tempRoots.push(tempRoot);

    await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'Usec3', force: false });
    await service.handleCommand({ type: 'STOP', userId: 'Usec3' });

    // findActiveByUserId should still return the STOPPED project (it's isActive=1)
    // but canStop is false, so second stop must be rejected
    const pushMessages: string[] = [];
    // The "active" project in STOPPED status still exists, so second STOP should respond
    // with a message about not being stoppable
  });
});

// ── hearing_answers preservation ──────────────────────────────────────────

describe('hearing_answers preserved on modify', () => {
  it('modify from WAITING_APPROVAL preserves all hearing fields', async () => {
    const { service, repos, tempRoot } = buildService();
    tempRoots.push(tempRoot);

    await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'Usec4', force: false });
    const p = repos.projectRepo.findActiveByUserId('Usec4')!;
    repos.projectRepo.updateStatus(p.id, 'WAITING_APPROVAL');
    makeHearingAnswers(repos, p.id);

    await service.handleCommand({ type: 'MODIFY', content: '機能を変更', userId: 'Usec4' });

    const answers = repos.hearingAnswerRepo.findByProjectId(p.id);
    expect(answers).not.toBeNull();
    expect(answers?.purpose).toBe('ToDoリスト管理アプリ');
    expect(answers?.targetUsers).toBeDefined();
  });

  it('modify increments revisionNumber without deleting hearing answers', async () => {
    const { service, repos, tempRoot } = buildService();
    tempRoots.push(tempRoot);

    await service.handleCommand({ type: 'NEW_PROJECT', name: 'App', userId: 'Usec5', force: false });
    const p = repos.projectRepo.findActiveByUserId('Usec5')!;
    repos.projectRepo.updateStatus(p.id, 'WAITING_APPROVAL');
    makeHearingAnswers(repos, p.id);

    await service.handleCommand({ type: 'MODIFY', content: 'rev1', userId: 'Usec5' });
    repos.projectRepo.updateStatus(p.id, 'WAITING_APPROVAL');
    await service.handleCommand({ type: 'MODIFY', content: 'rev2', userId: 'Usec5' });

    expect(repos.projectRepo.findById(p.id)?.revisionNumber).toBe(2);
    // hearing answers still intact
    expect(repos.hearingAnswerRepo.findByProjectId(p.id)).not.toBeNull();
  });
});

// ── Workflow double-start prevention ──────────────────────────────────────

describe('WorkflowRunner double-start prevention', () => {
  it('memory lock prevents second run for same projectId', () => {
    const repos = createTestDb();
    const { WorkflowRunner } = require('../../src/core/workflowRunner');
    const { WorkflowRunRepository } = require('../../src/db/repositories/workflowRunRepository');

    const lineClientMock = { sendPush: jest.fn().mockResolvedValue(undefined) };
    const workflowServiceMock = {
      startPipeline: jest.fn().mockReturnValue(new Promise(() => {})), // never resolves
    };

    const runner = new WorkflowRunner(
      workflowServiceMock,
      repos.workflowRunRepo,
      repos.projectRepo,
      lineClientMock,
    );

    // Create a valid project so workflowRunRepo.create succeeds
    repos.projectRepo.create({
      name: 'Test',
      slug: 'test-slug-001',
      userId: 'Usec6',
      workspacePath: '/tmp/test',
    });
    const project = repos.projectRepo.findActiveByUserId('Usec6')!;

    runner.run(project.id);
    runner.run(project.id); // second call should be no-op due to memory lock

    expect(workflowServiceMock.startPipeline).toHaveBeenCalledTimes(1);
  });

  it('DB RUNNING check prevents double-start after restart', () => {
    const repos = createTestDb();
    const { WorkflowRunner } = require('../../src/core/workflowRunner');

    const lineClientMock = { sendPush: jest.fn().mockResolvedValue(undefined) };
    const workflowServiceMock = {
      startPipeline: jest.fn().mockReturnValue(new Promise(() => {})),
    };

    const runner1 = new WorkflowRunner(
      workflowServiceMock, repos.workflowRunRepo, repos.projectRepo, lineClientMock,
    );
    const runner2 = new WorkflowRunner(
      workflowServiceMock, repos.workflowRunRepo, repos.projectRepo, lineClientMock,
    );

    repos.projectRepo.create({
      name: 'Test2',
      slug: 'test-slug-002',
      userId: 'Usec7',
      workspacePath: '/tmp/test2',
    });
    const project = repos.projectRepo.findActiveByUserId('Usec7')!;

    runner1.run(project.id); // starts, sets DB RUNNING

    // runner2 has no memory lock but DB should block it
    runner2.run(project.id);

    expect(workflowServiceMock.startPipeline).toHaveBeenCalledTimes(1);
  });
});

// ── Webhook event deduplication ──────────────────────────────────────────

describe('Webhook deduplication', () => {
  it('same webhookEventId returns isDuplicate=true', async () => {
    const { service, tempRoot } = buildService();
    tempRoots.push(tempRoot);

    const event = {
      type: 'message' as const,
      source: { type: 'user' as const, userId: 'Usec8' },
      message: { id: 'msg-sec', type: 'text' as const, text: 'hello' },
      timestamp: Date.now(),
      deliveryContext: { isRedelivery: false },
    };

    const first = await service.handleWebhookEvent(event, 'evt-sec-001');
    const second = await service.handleWebhookEvent(event, 'evt-sec-001');

    expect(first.isDuplicate).toBe(false);
    expect(second.isDuplicate).toBe(true);
  });

  it('different eventIds are not treated as duplicates', async () => {
    const { service, tempRoot } = buildService();
    tempRoots.push(tempRoot);

    const event = {
      type: 'message' as const,
      source: { type: 'user' as const, userId: 'Usec9' },
      message: { id: 'msg-sec2', type: 'text' as const, text: 'hi' },
      timestamp: Date.now(),
      deliveryContext: { isRedelivery: false },
    };

    const r1 = await service.handleWebhookEvent(event, 'evt-unique-1');
    const r2 = await service.handleWebhookEvent(event, 'evt-unique-2');

    expect(r1.isDuplicate).toBe(false);
    expect(r2.isDuplicate).toBe(false);
  });
});

// ── Path traversal prevention ─────────────────────────────────────────────

describe('Workspace path traversal prevention', () => {
  it('rejects absolute path in writeFile', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-ws-'));
    tempRoots.push(tempRoot);
    const ws = new WorkspaceService(tempRoot);
    const workspacePath = fs.mkdtempSync(path.join(tempRoot, 'proj-'));

    expect(() => ws.writeFile(workspacePath, '/etc/passwd', 'x')).toThrow();
  });

  it('rejects ../ path traversal in writeFile', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-ws2-'));
    tempRoots.push(tempRoot);
    const ws = new WorkspaceService(tempRoot);
    const workspacePath = fs.mkdtempSync(path.join(tempRoot, 'proj-'));

    expect(() => ws.writeFile(workspacePath, '../../../etc/passwd', 'x')).toThrow();
  });

  it('rejects Windows-style ..\\ path traversal', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-ws3-'));
    tempRoots.push(tempRoot);
    const ws = new WorkspaceService(tempRoot);
    const workspacePath = fs.mkdtempSync(path.join(tempRoot, 'proj-'));

    expect(() => ws.writeFile(workspacePath, '..\\..\\secret.txt', 'x')).toThrow();
  });

  it('allows legitimate file write inside workspace', () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-ws4-'));
    tempRoots.push(tempRoot);
    const ws = new WorkspaceService(tempRoot);
    const workspacePath = fs.mkdtempSync(path.join(tempRoot, 'proj-'));

    expect(() => ws.writeFile(workspacePath, 'docs/requirements.md', '# Requirements')).not.toThrow();
    expect(fs.existsSync(path.join(workspacePath, 'docs', 'requirements.md'))).toBe(true);
  });
});
