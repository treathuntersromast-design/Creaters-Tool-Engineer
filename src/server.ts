import express, { Request, Response, NextFunction } from 'express';
import { loadConfig } from './config/env';
import { lineSignatureMiddleware } from './line/webhookHandler';
import { createWebhookRouter } from './line/webhookRouter';
import { createAdminRouter } from './line/adminRouter';
import { ProjectService } from './core/projectService';
import { SessionService } from './core/sessionService';
import { MessageRepository } from './db/repositories/messageRepository';
import { LineClient } from './line/lineClient';
import { logger } from './utils/logger';

export function createServer(
  projectService: ProjectService,
  sessionService: SessionService,
  messageRepo: MessageRepository,
  lineClient: LineClient,
): express.Application {
  const config = loadConfig();
  const app = express();

  app.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.use(
    '/admin',
    express.json(),
    createAdminRouter(sessionService, messageRepo, lineClient),
  );

  app.use(
    '/webhook',
    express.raw({ type: 'application/json' }),
    // Step 1: save rawBody for signature verification
    (req: Request, _res: Response, next: NextFunction) => {
      (req as Request & { rawBody: Buffer }).rawBody = req.body as Buffer;
      next();
    },
    // Step 2: verify signature on rawBody BEFORE parsing JSON
    lineSignatureMiddleware(config.line.channelSecret),
    // Step 3: parse JSON — return 400 on malformed body
    (req: Request, res: Response, next: NextFunction) => {
      try {
        req.body = JSON.parse(((req as Request & { rawBody: Buffer }).rawBody).toString('utf-8'));
        next();
      } catch {
        res.status(400).json({ error: 'Invalid JSON' });
      }
    },
    createWebhookRouter({
      handleCommand: (cmd) => projectService.handleCommand(cmd),
      handleWebhookEvent: (event, eventId) => projectService.handleWebhookEvent(event, eventId),
      sendReply: (replyToken, text) => {
        return new LineClient().sendReply(replyToken, text);
      },
      getUserProjectStatus: (userId) => projectService.getUserProjectStatus(userId),
      isSessionAuthenticated: (userId) => sessionService.isAuthenticated(userId),
      isSessionPendingOtp: (userId) => sessionService.isPendingOtp(userId),
      verifySessionOtp: (userId, otp) => sessionService.verifyOtp(userId, otp),
      endSession: () => sessionService.endSession(true),
      recordInboundMessage: (userId, text, lineMessageId) => {
        try {
          messageRepo.create({ projectId: null, userId, direction: 'INBOUND', content: text, lineMessageId });
        } catch {
          // lineMessageId の重複は無視（UNIQUE インデックスによる）
        }
      },
    }),
  );

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found' });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error('Unhandled error', { err: err.message });
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
}
