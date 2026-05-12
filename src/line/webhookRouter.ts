import crypto from 'crypto';
import { Router, Request, Response } from 'express';
import { LineWebhookBody, LineEvent } from './lineTypes';
import { parseLineMessage } from './messageParser';
import { filterMessage } from '../security/commandFilter';
import { logger } from '../utils/logger';

const MAX_MESSAGE_LENGTH = 2000;

export interface WebhookRouterDeps {
  handleCommand: (command: ReturnType<typeof parseLineMessage> | { type: 'HEARING_REPLY'; content: string; userId: string }) => Promise<void>;
  handleWebhookEvent: (event: LineEvent, eventId: string) => Promise<{ isDuplicate: boolean }>;
  sendReply: (replyToken: string, text: string) => Promise<void>;
  getUserProjectStatus: (userId: string) => string | null;
  isSessionAuthenticated: (userId: string) => boolean;
  isSessionPendingOtp: (userId: string) => boolean;
  verifySessionOtp: (userId: string, otp: string) => Promise<boolean>;
  endSession: () => Promise<void>;
  /** 未認証ユーザーのメッセージをユーザーリスト用に保存する */
  recordInboundMessage: (userId: string, text: string, lineMessageId: string | null) => void;
}

export function createWebhookRouter(deps: WebhookRouterDeps): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const body = req.body as LineWebhookBody;

    if (!body || !Array.isArray(body.events)) {
      res.status(400).json({ error: 'Invalid body' });
      return;
    }

    res.status(200).json({ message: 'OK' });

    for (const event of body.events) {
      setImmediate(() => {
        processEvent(event, deps).catch((err) => {
          logger.error('Event processing error', { eventType: event.type, err: String(err) });
        });
      });
    }
  });

  return router;
}

async function processEvent(event: LineEvent, deps: WebhookRouterDeps): Promise<void> {
  const eventId = event.webhookEventId ?? `fallback-${event.timestamp}-${crypto.randomUUID()}`;

  // Handle group/room
  if (event.source.type !== 'user') {
    if (event.replyToken) {
      await deps.sendReply(event.replyToken, '個別チャットで使ってください。');
    }
    return;
  }

  const userId = event.source.userId;
  if (!userId) {
    logger.warn('No userId in event', { eventType: event.type });
    return;
  }

  // Deduplication check
  const { isDuplicate } = await deps.handleWebhookEvent(event, eventId);
  if (isDuplicate) {
    logger.debug('Duplicate webhook event, skipping', { eventId });
    return;
  }

  // Follow event: always respond regardless of session state
  if (event.type === 'follow') {
    await deps.sendReply(event.replyToken!, [
      'LINE AI Dev Orchestrator へようこそ！',
      '',
      '担当者がPCで認証を開始すると使用できます。',
    ].join('\n'));
    return;
  }

  // Message event only
  if (event.type !== 'message' || !event.message) {
    if (event.replyToken) {
      await deps.sendReply(event.replyToken, 'テキストメッセージのみ対応しています。');
    }
    return;
  }

  if (event.message.type !== 'text') {
    await deps.sendReply(event.replyToken!, 'テキストメッセージのみ対応しています。');
    return;
  }

  const text = event.message.text.trim();

  if (text.length > MAX_MESSAGE_LENGTH) {
    if (event.replyToken) {
      await deps.sendReply(
        event.replyToken,
        `メッセージが長すぎます（最大${MAX_MESSAGE_LENGTH}文字）。短くして再送してください。`,
      );
    }
    return;
  }

  // Session: OTP verification phase — filter doesn't apply (only 6-digit codes)
  if (deps.isSessionPendingOtp(userId)) {
    await deps.verifySessionOtp(userId, text);
    return;
  }

  // Session: not authenticated → record for user list, then ignore
  if (!deps.isSessionAuthenticated(userId)) {
    deps.recordInboundMessage(userId, text, event.message.id ?? null);
    logger.debug('Recorded message from unauthenticated user', { userId });
    return;
  }

  // Security filter — block dangerous instructions before any processing
  const secCheck = filterMessage(text);
  if (secCheck.blocked) {
    logger.warn('Blocked dangerous message', { userId, reason: secCheck.reason });
    if (event.replyToken) {
      await deps.sendReply(
        event.replyToken,
        `⚠️ セキュリティ上の理由によりこのメッセージは処理できません。\n` +
        `（理由: ${secCheck.reason}）\n\n` +
        `このアプリは機密情報の取得・外部公開・破壊的操作には対応していません。`,
      );
    }
    return;
  }

  const parsed = parseLineMessage(text, userId);

  // Session end command
  if (parsed.type === 'SESSION_END') {
    await deps.endSession();
    return;
  }

  // HEARING中の入力は、認識されたコマンドでもヒアリング回答として扱う
  // (GIT_CONFIRM「はい」等がヒアリング回答に干渉しないように)
  const projectStatus = deps.getUserProjectStatus(userId);
  if (parsed.type === 'UNKNOWN') {
    if (projectStatus === 'HEARING') {
      await deps.handleCommand({ type: 'HEARING_REPLY', content: text, userId });
    } else {
      if (event.replyToken) {
        await deps.sendReply(event.replyToken, [
          'コマンドが認識できませんでした。',
          '',
          '「コマンド一覧」と送ると使えるコマンドを表示します。',
        ].join('\n'));
      }
    }
    return;
  }

  // HEARING中の「はい/いいえ/キャンセル」はヒアリング回答として扱う
  if (projectStatus === 'HEARING' &&
      (parsed.type === 'GIT_CONFIRM' || parsed.type === 'GIT_CANCEL')) {
    await deps.handleCommand({ type: 'HEARING_REPLY', content: text, userId });
    return;
  }

  await deps.handleCommand(parsed);
}
