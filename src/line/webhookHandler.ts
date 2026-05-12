import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function verifyLineSignature(rawBody: Buffer, signature: string, channelSecret: string): boolean {
  const expected = crypto
    .createHmac('SHA256', channelSecret)
    .update(rawBody)
    .digest('base64');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const signatureBuf = Buffer.from(signature, 'utf8');

  if (expectedBuf.length !== signatureBuf.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuf, signatureBuf);
}

export function lineSignatureMiddleware(channelSecret: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const signature = req.headers['x-line-signature'] as string | undefined;

    if (!signature) {
      logger.warn('Missing x-line-signature header', { ip: req.ip });
      res.status(401).json({ error: 'Missing signature' });
      return;
    }

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      logger.warn('Missing raw body', { ip: req.ip });
      res.status(400).json({ error: 'Missing raw body' });
      return;
    }

    if (!verifyLineSignature(rawBody, signature, channelSecret)) {
      logger.warn('LINE signature verification failed', { ip: req.ip });
      res.status(401).json({ error: 'Invalid signature' });
      return;
    }

    next();
  };
}
