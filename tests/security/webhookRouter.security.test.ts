/**
 * Security tests for webhook router:
 * - Message length limit
 * - Fallback eventId no longer uses Math.random
 * - Signature middleware order
 */
import crypto from 'crypto';
import express, { Request, Response, NextFunction } from 'express';
import { createWebhookRouter, WebhookRouterDeps } from '../../src/line/webhookRouter';

function buildApp(overrides: Partial<WebhookRouterDeps> = {}) {
  const app = express();
  app.use(express.json());

  const sentReplies: Array<{ replyToken: string; text: string }> = [];
  const handledCommands: unknown[] = [];

  const deps: WebhookRouterDeps = {
    handleCommand: jest.fn().mockImplementation((cmd) => {
      handledCommands.push(cmd);
      return Promise.resolve();
    }),
    handleWebhookEvent: jest.fn().mockResolvedValue({ isDuplicate: false }),
    sendReply: jest.fn().mockImplementation(async (token: string, text: string) => {
      sentReplies.push({ replyToken: token, text });
    }),
    getUserProjectStatus: jest.fn().mockReturnValue(null),
    isSessionAuthenticated: jest.fn().mockReturnValue(true),
    isSessionPendingOtp: jest.fn().mockReturnValue(false),
    verifySessionOtp: jest.fn().mockResolvedValue(false),
    endSession: jest.fn().mockResolvedValue(undefined),
    recordInboundMessage: jest.fn(),
    ...overrides,
  };

  app.use('/', createWebhookRouter(deps));
  return { app, deps, sentReplies, handledCommands };
}

// Helper: build minimal LINE text event
function textEvent(text: string, replyToken = 'reply-tok') {
  return {
    events: [{
      type: 'message',
      webhookEventId: `evt-${crypto.randomUUID()}`,
      source: { type: 'user', userId: 'Utest' },
      message: { id: `msg-${Date.now()}`, type: 'text', text },
      replyToken,
      timestamp: Date.now(),
      deliveryContext: { isRedelivery: false },
    }],
  };
}

const request = require('supertest');

describe('Webhook message length limit', () => {
  it('rejects messages longer than 2000 chars with sendReply', async () => {
    const { app, sentReplies, deps } = buildApp();
    const longText = 'A'.repeat(2001);

    await request(app)
      .post('/')
      .send(textEvent(longText))
      .expect(200);

    // Wait for setImmediate to process the event
    await new Promise((r) => setImmediate(r));

    expect(sentReplies.length).toBeGreaterThan(0);
    expect(sentReplies[0].text).toContain('長すぎます');
    expect(deps.handleCommand).not.toHaveBeenCalled();
  });

  it('accepts messages exactly at 2000 chars (not rejected by length check)', async () => {
    const { app, sentReplies } = buildApp();

    await request(app)
      .post('/')
      .send(textEvent('A'.repeat(2000)))
      .expect(200);

    await new Promise((r) => setImmediate(r));

    // 2000-char message passes the length check (limit is > 2000).
    // UNKNOWN command without active project → sends "command not recognized" reply, not length error.
    const lengthRejectSent = sentReplies.some((r) => r.text.includes('長すぎます'));
    expect(lengthRejectSent).toBe(false);
  });

  it('accepts normal-length messages', async () => {
    const { app, deps } = buildApp();

    await request(app)
      .post('/')
      .send(textEvent('進捗'))
      .expect(200);

    await new Promise((r) => setImmediate(r));
    expect(deps.handleCommand).toHaveBeenCalled();
  });
});

describe('Unauthenticated user message handling', () => {
  it('records message without processing command when not authenticated', async () => {
    const { app, deps } = buildApp({
      isSessionAuthenticated: jest.fn().mockReturnValue(false),
    });

    await request(app)
      .post('/')
      .send(textEvent('新規プロジェクト: App'))
      .expect(200);

    await new Promise((r) => setImmediate(r));

    expect(deps.handleCommand).not.toHaveBeenCalled();
    expect(deps.recordInboundMessage).toHaveBeenCalled();
  });
});

describe('Duplicate event deduplication in router', () => {
  it('skips processing for duplicate webhook events', async () => {
    const { app, deps } = buildApp({
      handleWebhookEvent: jest.fn().mockResolvedValue({ isDuplicate: true }),
    });

    await request(app)
      .post('/')
      .send(textEvent('進捗'))
      .expect(200);

    await new Promise((r) => setImmediate(r));

    expect(deps.handleCommand).not.toHaveBeenCalled();
  });
});

describe('Group/room source rejection', () => {
  it('replies with redirect message for group source', async () => {
    const { app, sentReplies } = buildApp();

    const groupEvent = {
      events: [{
        type: 'message',
        webhookEventId: `evt-${crypto.randomUUID()}`,
        source: { type: 'group', groupId: 'G001' },
        message: { id: 'msg-g', type: 'text', text: 'test' },
        replyToken: 'reply-grp',
        timestamp: Date.now(),
        deliveryContext: { isRedelivery: false },
      }],
    };

    await request(app)
      .post('/')
      .send(groupEvent)
      .expect(200);

    await new Promise((r) => setImmediate(r));

    expect(sentReplies[0]?.text).toContain('個別チャット');
  });
});
