import winston from 'winston';
import { loadConfig } from '../config/env';

const MASK_KEYS = new Set([
  'channelAccessToken',
  'channelSecret',
  'authorization',
  'x-line-signature',
  'replyToken',
  'LINE_CHANNEL_ACCESS_TOKEN',
  'LINE_CHANNEL_SECRET',
]);

function sanitizeValue(key: string, value: unknown): unknown {
  if (MASK_KEYS.has(key)) return '[REDACTED]';
  if (key === 'userId' && typeof value === 'string' && value.length > 4) {
    return '*'.repeat(value.length - 4) + value.slice(-4);
  }
  return value;
}

export function sanitizeLogObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sanitizeLogObject);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    result[key] = MASK_KEYS.has(key)
      ? sanitizeValue(key, value)
      : key === 'userId'
      ? sanitizeValue(key, value)
      : typeof value === 'object'
      ? sanitizeLogObject(value)
      : value;
  }
  return result;
}

const sanitizeFormat = winston.format((info) => {
  const sanitized = sanitizeLogObject(info) as winston.Logform.TransformableInfo;
  return sanitized;
});

let _logger: winston.Logger | null = null;

export function getLogger(): winston.Logger {
  if (_logger) return _logger;

  let level = 'info';
  try {
    level = loadConfig().log.level;
  } catch {
    // ignore if config not loaded yet
  }

  _logger = winston.createLogger({
    level,
    format: winston.format.combine(
      sanitizeFormat(),
      winston.format.timestamp(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    transports: [new winston.transports.Console()],
  });

  return _logger;
}

export const logger = {
  error: (message: string, meta?: Record<string, unknown>) =>
    getLogger().error(message, meta ? sanitizeLogObject(meta) : undefined),
  warn: (message: string, meta?: Record<string, unknown>) =>
    getLogger().warn(message, meta ? sanitizeLogObject(meta) : undefined),
  info: (message: string, meta?: Record<string, unknown>) =>
    getLogger().info(message, meta ? sanitizeLogObject(meta) : undefined),
  debug: (message: string, meta?: Record<string, unknown>) =>
    getLogger().debug(message, meta ? sanitizeLogObject(meta) : undefined),
};
