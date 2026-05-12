import { Router, Request, Response, NextFunction } from 'express';
import { SessionService } from '../core/sessionService';
import { MessageRepository } from '../db/repositories/messageRepository';
import { LineClient } from './lineClient';
import { discoverRepositories } from '../git/repositoryDiscovery';
import { logger } from '../utils/logger';

/** userId → displayName のインメモリキャッシュ（プロセス再起動でリセット） */
const profileCache = new Map<string, { displayName: string; fetchedAt: number }>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10分

function localhostOnly(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? req.socket.remoteAddress ?? '';
  const allowed = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];
  if (allowed.includes(ip)) {
    next();
    return;
  }
  logger.warn('Admin API access denied', { ip });
  res.status(403).json({ error: 'Forbidden' });
}

async function resolveDisplayName(userId: string, lineClient: LineClient): Promise<string> {
  const cached = profileCache.get(userId);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.displayName;
  }
  const profile = await lineClient.getProfile(userId);
  const displayName = profile?.displayName ?? userId.slice(-12);
  profileCache.set(userId, { displayName, fetchedAt: Date.now() });
  return displayName;
}

export function createAdminRouter(
  sessionService: SessionService,
  messageRepo: MessageRepository,
  lineClient: LineClient,
): Router {
  const router = Router();
  router.use(localhostOnly);

  router.get('/health', (_req: Request, res: Response) => {
    res.json({ status: 'ok' });
  });

  router.get('/users', async (_req: Request, res: Response) => {
    const users = messageRepo.listDistinctUsers();
    const usersWithNames = await Promise.all(
      users.map(async (u) => ({
        ...u,
        displayName: await resolveDisplayName(u.userId, lineClient),
      })),
    );
    res.json({ users: usersWithNames });
  });

  router.get('/session/status', (_req: Request, res: Response) => {
    const session = sessionService.getSessionInfo();
    res.json({
      status: session.status,
      selectedUserId: session.selectedUserId,
      otpExpiry: session.otpExpiry,
      updatedAt: session.updatedAt,
    });
  });

  router.post('/session/start', async (req: Request, res: Response) => {
    const { userId } = req.body as { userId?: string };
    if (!userId || typeof userId !== 'string') {
      res.status(400).json({ ok: false, message: 'userId is required' });
      return;
    }
    const result = await sessionService.initiateSession(userId);
    res.status(result.ok ? 200 : 400).json(result);
  });

  router.post('/session/stop', async (_req: Request, res: Response) => {
    await sessionService.endSession(true);
    res.json({ ok: true, message: 'セッションを終了しました' });
  });

  router.get('/repos', (_req: Request, res: Response) => {
    try {
      const repos = discoverRepositories();
      res.json({ repos });
    } catch (err) {
      logger.error('Failed to discover repos', { err: String(err) });
      res.json({ repos: [] });
    }
  });

  return router;
}
