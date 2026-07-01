/**
 * Security tests for the internal API token guard (/admin, /chat).
 * These endpoints are reachable via the public ngrok tunnel because ngrok
 * forwards from localhost, so IP-based localhostOnly is not sufficient.
 */
import express from 'express';
import { internalTokenGuard } from '../../src/line/internalAuth';

const request = require('supertest');

function buildApp(token: string) {
  const app = express();
  app.use(internalTokenGuard(token));
  app.get('/protected', (_req, res) => res.json({ ok: true }));
  return app;
}

describe('internalTokenGuard', () => {
  const TOKEN = 'a'.repeat(64);

  it('rejects requests with no token (403)', async () => {
    await request(buildApp(TOKEN)).get('/protected').expect(403);
  });

  it('rejects requests with a wrong token (403)', async () => {
    await request(buildApp(TOKEN))
      .get('/protected')
      .set('x-internal-token', 'b'.repeat(64))
      .expect(403);
  });

  it('rejects a token of different length (403, no timingSafeEqual throw)', async () => {
    await request(buildApp(TOKEN))
      .get('/protected')
      .set('x-internal-token', 'short')
      .expect(403);
  });

  it('allows requests with the correct token', async () => {
    await request(buildApp(TOKEN))
      .get('/protected')
      .set('x-internal-token', TOKEN)
      .expect(200)
      .expect({ ok: true });
  });
});
