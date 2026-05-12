import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { loadConfig } from '../config/env';
import { runMigrations, cleanupStaleWorkflowRuns } from './migrations';
import { logger } from '../utils/logger';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (db) return db;

  const config = loadConfig();
  const dbPath = path.resolve(config.db.path);
  const dir = path.dirname(dbPath);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  runMigrations(db);
  cleanupStaleWorkflowRuns(db);
  logger.info('Database initialized', { path: dbPath });

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
    logger.info('Database closed');
  }
}
