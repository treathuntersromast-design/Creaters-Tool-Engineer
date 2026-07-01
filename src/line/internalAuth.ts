import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

/**
 * 内部 API（/admin・/chat）専用の認証ミドルウェア。
 *
 * localhostOnly（IP 判定）だけでは ngrok 経由の転送を防げない。
 * ngrok エージェントは同一 PC 上で動作し http://localhost:PORT へ転送するため、
 * Express から見た接続元は常に 127.0.0.1 になり IP 判定を素通りしてしまう。
 * そこでプロセス起動時に生成した推測不能なトークンを共有し、
 * Electron メインプロセスからの正当なリクエストのみを通す。
 */
export function internalTokenGuard(token: string) {
  const expected = Buffer.from(token, 'utf8');

  return (req: Request, res: Response, next: NextFunction): void => {
    const provided = req.headers['x-internal-token'];

    if (typeof provided === 'string') {
      const actual = Buffer.from(provided, 'utf8');
      if (actual.length === expected.length && crypto.timingSafeEqual(actual, expected)) {
        next();
        return;
      }
    }

    logger.warn('Internal API access denied (invalid token)', { ip: req.ip, path: req.path });
    res.status(403).json({ error: 'Forbidden' });
  };
}
