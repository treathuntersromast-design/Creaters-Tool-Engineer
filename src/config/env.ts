import dotenv from 'dotenv';
dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

export interface AppConfig {
  line: {
    channelSecret: string;
    channelAccessToken: string;
  };
  ai: {
    apiKey: string | undefined;
  };
  db: {
    path: string;
  };
  workspace: {
    root: string;
  };
  server: {
    port: number;
    host: string;
  };
  log: {
    level: string;
  };
  isTest: boolean;
}

let _config: AppConfig | null = null;

export function loadConfig(): AppConfig {
  if (_config) return _config;

  const isTest = process.env['NODE_ENV'] === 'test';

  if (!isTest) {
    requireEnv('LINE_CHANNEL_SECRET');
    requireEnv('LINE_CHANNEL_ACCESS_TOKEN');
  }

  _config = {
    line: {
      channelSecret: process.env['LINE_CHANNEL_SECRET'] ?? 'test-secret',
      channelAccessToken: process.env['LINE_CHANNEL_ACCESS_TOKEN'] ?? 'test-token',
    },
    ai: {
      apiKey: process.env['ANTHROPIC_API_KEY'],
    },
    db: {
      path: process.env['DB_PATH'] ?? './data/dev.db',
    },
    workspace: {
      root: process.env['WORKSPACE_ROOT'] ?? './workspace',
    },
    server: {
      port: parseInt(process.env['PORT'] ?? '3000', 10),
      host: process.env['HOST'] ?? '127.0.0.1',
    },
    log: {
      level: process.env['LOG_LEVEL'] ?? 'info',
    },
    isTest,
  };

  return _config;
}

export function resetConfig(): void {
  _config = null;
}
