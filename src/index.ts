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
import { LessonsLearnedRepository } from './db/repositories/lessonsLearnedRepository';
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
import { ClaudeCodeService } from './claude/claudeCodeService';
import { checkWindowsUpdateStatus, isUpdateImminent, pauseWindowsUpdate, formatWuStatus } from './system/windowsUpdateService';
import { AddressInfo, Server } from 'net';
import crypto from 'crypto';
import { createServer } from './server';
import { logger } from './utils/logger';

export interface ServerHandle {
  port: number;
  /** /admin・/chat 内部 API 用の共有トークン（Electron メインプロセスへ渡す） */
  internalToken: string;
  close: () => Promise<void>;
}

export async function startServer(): Promise<ServerHandle> {
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
  const lessonsRepo       = new LessonsLearnedRepository(db);
  const sessionRepo       = new SessionRepository(db);

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
    workspaceService, lineClient, stateMachine, agentFactory, lessonsRepo
  );

  const workflowRunner = new WorkflowRunner(
    workflowService, workflowRunRepo, projectRepo, lineClient
  );

  const gitService        = new GitService();
  const gitSession        = new GitSessionManager();
  const gitCommandService = new GitCommandService(gitService, gitSession, lineClient);
  const editorService     = new EditorService(lineClient);
  const claudeCodeService = new ClaudeCodeService(lineClient);

  const projectService = new ProjectService(
    projectRepo, messageRepo, agentRepo, approvalRepo, webhookEventRepo,
    hearingAnswerRepo, workspaceService, workflowRunner, workflowService,
    stateMachine, agentFactory, lineClient, gitCommandService, editorService, aiClient,
    claudeCodeService, lessonsRepo,
  );

  const internalToken = crypto.randomBytes(32).toString('hex');
  const app = createServer(projectService, sessionService, messageRepo, lineClient, internalToken);

  // 起動時 Windows Update チェック（失敗してもサーバー起動は続行）
  checkWindowsUpdateStatus().then(async (status) => {
    if (!status.isWindows) return;

    if (isUpdateImminent(status) && !status.pauseExpiry) {
      logger.info('Windows Update pending at startup — pausing for 7 days');
      const pauseResult = await pauseWindowsUpdate(7);
      const msg = formatWuStatus(status, pauseResult);
      logger.info('WU startup pause result', { ok: pauseResult.ok, expiry: pauseResult.expiry });

      // ADMIN_USER_ID が設定されていれば LINE にも通知
      const adminUserId = process.env['ADMIN_USER_ID'];
      if (adminUserId) {
        await lineClient.sendPush(adminUserId, `🖥️ 【起動時通知】\n${msg}`).catch(() => void 0);
      }
    } else if (status.rebootRequired) {
      logger.warn('Windows reboot is pending — update applied but not yet effective');
    }
  }).catch((err) => {
    logger.warn('Startup WU check failed', { err: String(err) });
  });

  return new Promise<ServerHandle>((resolve, reject) => {
    const server: Server = app.listen(config.server.port, config.server.host, () => {
      const { port } = server.address() as AddressInfo;
      process.stdout.write(`ASSIGNED_PORT=${port}\n`);
      logger.info('Server started', { port, host: config.server.host });
      logger.info('LINE Webhook endpoint', { url: `http://localhost:${port}/webhook` });
      logger.info('Admin API', { url: `http://localhost:${port}/admin` });
      resolve({
        port,
        internalToken,
        close: () => new Promise<void>((res) => {
          server.close(() => { closeDatabase(); res(); });
        }),
      });
    });

    server.on('error', reject);
  });
}

// スタンドアロン起動（npm run dev / npm start）
if (require.main === module) {
  startServer().then(({ port, close }) => {
    logger.info('Running standalone', { port });

    const shutdown = (): void => {
      logger.info('Shutting down...');
      close().then(() => process.exit(0)).catch(() => process.exit(1));
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }).catch((err: unknown) => {
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}
