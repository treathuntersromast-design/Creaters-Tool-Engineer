import { loadConfig } from './config/env';
import { getDatabase, closeDatabase } from './db/database';
import { ProjectRepository } from './db/repositories/projectRepository';
import { MessageRepository } from './db/repositories/messageRepository';
import { AgentRepository } from './db/repositories/agentRepository';
import { TaskRepository } from './db/repositories/taskRepository';
import { DocumentRepository } from './db/repositories/documentRepository';
import { ApprovalRepository } from './db/repositories/approvalRepository';
import { WebhookEventRepository } from './db/repositories/webhookEventRepository';
import { WorkflowRunRepository } from './db/repositories/workflowRunRepository';
import { HearingAnswerRepository } from './db/repositories/hearingAnswerRepository';
import { SessionRepository } from './db/repositories/sessionRepository';
import { WorkspaceService } from './core/workspaceService';
import { StateMachine } from './core/stateMachine';
import { AgentFactory } from './agents/AgentFactory';
import { AiClient } from './ai/aiClient';
import { LineClient } from './line/lineClient';
import { WorkflowService } from './core/workflowService';
import { WorkflowRunner } from './core/workflowRunner';
import { ProjectService } from './core/projectService';
import { SessionService } from './core/sessionService';
import { GitService } from './git/gitService';
import { GitSessionManager } from './git/gitSessionManager';
import { GitCommandService } from './git/gitCommandService';
import { EditorService } from './editor/editorService';
import { AddressInfo } from 'net';
import { createServer } from './server';
import { logger } from './utils/logger';

async function main(): Promise<void> {
  const config = loadConfig();
  const db = getDatabase();

  const projectRepo       = new ProjectRepository(db);
  const messageRepo       = new MessageRepository(db);
  const agentRepo         = new AgentRepository(db);
  const taskRepo          = new TaskRepository(db);
  const documentRepo      = new DocumentRepository(db);
  const approvalRepo      = new ApprovalRepository(db);
  const webhookEventRepo  = new WebhookEventRepository(db);
  const workflowRunRepo   = new WorkflowRunRepository(db);
  const hearingAnswerRepo = new HearingAnswerRepository(db);
  const sessionRepo       = new SessionRepository(db);

  // Clean up stale OTP session from previous run
  sessionRepo.cleanupExpiredOtp();

  const workspaceService = new WorkspaceService();
  const stateMachine     = new StateMachine();
  const aiClient         = config.ai.apiKey ? new AiClient(config.ai.apiKey) : undefined;
  const agentFactory     = new AgentFactory(aiClient);
  const lineClient       = new LineClient();

  if (aiClient) {
    logger.info('AI mode: Claude API enabled');
  } else {
    logger.info('AI mode: mock (set ANTHROPIC_API_KEY to enable Claude API)');
  }

  const sessionService = new SessionService(sessionRepo, lineClient);

  const workflowService = new WorkflowService(
    projectRepo, taskRepo, agentRepo, documentRepo, hearingAnswerRepo,
    workspaceService, lineClient, stateMachine, agentFactory
  );

  const workflowRunner = new WorkflowRunner(
    workflowService, workflowRunRepo, projectRepo, lineClient
  );

  const gitService        = new GitService();
  const gitSession        = new GitSessionManager();
  const gitCommandService = new GitCommandService(gitService, gitSession, lineClient);
  const editorService     = new EditorService(lineClient);

  const projectService = new ProjectService(
    projectRepo, messageRepo, agentRepo, approvalRepo, webhookEventRepo,
    hearingAnswerRepo, workspaceService, workflowRunner, workflowService,
    stateMachine, agentFactory, lineClient, gitCommandService, editorService
  );

  const app = createServer(projectService, sessionService, messageRepo, lineClient);

  // port 0 = OSが空きポートを自動割当（他の開発サーバーとの衝突を防ぐ）
  const server = app.listen(0, config.server.host, () => {
    const { port } = server.address() as AddressInfo;
    // Electronがstdoutを監視してポートを取得する
    process.stdout.write(`ASSIGNED_PORT=${port}\n`);
    logger.info('Server started', { port, host: config.server.host });
    logger.info('LINE Webhook endpoint', { url: `http://localhost:${port}/webhook` });
    logger.info('Admin API', { url: `http://localhost:${port}/admin` });
  });

  const shutdown = (): void => {
    logger.info('Shutting down...');
    server.close(() => {
      closeDatabase();
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err: unknown) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
