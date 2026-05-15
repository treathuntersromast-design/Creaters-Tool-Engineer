import { Router, Request, Response } from 'express';
import express from 'express';
import { parseLineMessage } from './messageParser';
import { filterMessage } from '../security/commandFilter';
import { ProjectService } from '../core/projectService';
import { LineClient } from './lineClient';
import { logger } from '../utils/logger';

const MAX_TEXT_LENGTH = 2000;

export function createLocalChatRouter(
  projectService: ProjectService,
  lineClient: LineClient,
): Router {
  const router = Router();
  router.use(express.json());

  router.post('/', async (req: Request, res: Response) => {
    const { text, userId: reqUserId } = req.body as { text?: string; userId?: string };

    if (!text || typeof text !== 'string' || !text.trim()) {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const trimmed = text.trim();

    if (trimmed.length > MAX_TEXT_LENGTH) {
      res.json({ messages: [`メッセージが長すぎます（最大${MAX_TEXT_LENGTH}文字）`] });
      return;
    }

    const userId = (reqUserId ?? '').trim() || 'LOCAL_PC_USER';

    const messages: string[] = [];
    lineClient.addCollector(userId, (msg) => messages.push(msg));

    try {
      // Security filter
      const secCheck = filterMessage(trimmed);
      if (secCheck.blocked) {
        messages.push(`⚠️ セキュリティ上の理由でブロックされました。\n（理由: ${secCheck.reason}）`);
        res.json({ messages });
        return;
      }

      // Claude plan pending — intercept before normal parsing
      if (projectService.isClaudePlanPending(userId)) {
        await projectService.handleCommand({ type: 'CLAUDE_CONFIRM', content: trimmed, userId });
        res.json({ messages });
        return;
      }

      const parsed = parseLineMessage(trimmed, userId);

      // SESSION_END is a LINE-only concept; in local chat just acknowledge
      if (parsed.type === 'SESSION_END') {
        messages.push('PC チャットからはセッション終了できません。アプリの停止ボタンを使ってください。');
        res.json({ messages });
        return;
      }

      await projectService.handleCommand(parsed);
    } catch (err) {
      logger.error('Local chat processing error', { err: String(err), userId });
      messages.push('❌ エラーが発生しました。ログを確認してください。');
    } finally {
      lineClient.removeCollector(userId);
    }

    res.json({ messages });
  });

  return router;
}
