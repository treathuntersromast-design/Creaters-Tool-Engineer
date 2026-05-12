import Database from 'better-sqlite3';
import { SCHEMA_V1_SQL, SCHEMA_V2_SQL } from './schema';
import { logger } from '../utils/logger';

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  { version: 1, sql: SCHEMA_V1_SQL },
  { version: 2, sql: SCHEMA_V2_SQL },
];

export function runMigrations(db: Database.Database): void {
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  const current = db.pragma('user_version', { simple: true }) as number;
  logger.info('Running DB migrations', { currentVersion: current });

  for (const migration of MIGRATIONS.filter((m) => m.version > current)) {
    const run = db.transaction(() => {
      db.exec(migration.sql);
      db.pragma(`user_version = ${migration.version}`);
    });
    run();
    logger.info('Migration applied', { version: migration.version });
  }
}

export function cleanupStaleWorkflowRuns(db: Database.Database): void {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const result = db.prepare(`
    UPDATE workflow_runs
    SET status = 'FAILED', finishedAt = ?, error = 'stale: process restarted'
    WHERE status = 'RUNNING' AND startedAt < ?
  `).run(new Date().toISOString(), cutoff);

  if ((result.changes as number) > 0) {
    logger.warn('Cleaned up stale workflow runs', { count: result.changes });
  }
}
