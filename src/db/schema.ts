export const SCHEMA_V1_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  userId TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'CREATED',
  isActive INTEGER NOT NULL DEFAULT 1,
  previousStatus TEXT,
  lastError TEXT,
  revisionNumber INTEGER NOT NULL DEFAULT 0,
  workspacePath TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  projectId TEXT REFERENCES projects(id),
  userId TEXT NOT NULL,
  direction TEXT NOT NULL CHECK(direction IN ('INBOUND','OUTBOUND')),
  content TEXT NOT NULL,
  lineMessageId TEXT,
  createdAt TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_lineMessageId
  ON messages(lineMessageId)
  WHERE lineMessageId IS NOT NULL;

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  agentId TEXT REFERENCES agents(id),
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  input TEXT,
  output TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL,
  filePath TEXT NOT NULL,
  content TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  comment TEXT,
  createdAt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  lineWebhookEventId TEXT UNIQUE NOT NULL,
  lineMessageId TEXT,
  userId TEXT,
  eventType TEXT NOT NULL,
  isRedelivery INTEGER NOT NULL DEFAULT 0,
  receivedAt TEXT NOT NULL,
  processedAt TEXT,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  error TEXT
);

CREATE TABLE IF NOT EXISTS workflow_runs (
  id TEXT PRIMARY KEY,
  projectId TEXT NOT NULL REFERENCES projects(id),
  status TEXT NOT NULL DEFAULT 'RUNNING',
  startedAt TEXT NOT NULL,
  finishedAt TEXT,
  error TEXT
);

CREATE TABLE IF NOT EXISTS hearing_answers (
  id TEXT PRIMARY KEY,
  projectId TEXT UNIQUE NOT NULL REFERENCES projects(id),
  purpose TEXT,
  targetUsers TEXT,
  requiredFeatures TEXT,
  screens TEXT,
  techStack TEXT,
  priority TEXT,
  deployment TEXT,
  testScope TEXT,
  rawText TEXT,
  updatedAt TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_projects_userId ON projects(userId);
CREATE INDEX IF NOT EXISTS idx_messages_projectId ON messages(projectId);
CREATE INDEX IF NOT EXISTS idx_tasks_projectId ON tasks(projectId);
CREATE INDEX IF NOT EXISTS idx_documents_projectId ON documents(projectId);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_projectId ON workflow_runs(projectId);
`;

export const SCHEMA_V2_SQL = `
CREATE TABLE IF NOT EXISTS app_session (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  selectedUserId TEXT,
  otp TEXT,
  otpExpiry TEXT,
  status TEXT NOT NULL DEFAULT 'INACTIVE',
  updatedAt TEXT NOT NULL
);

INSERT OR IGNORE INTO app_session (id, status, updatedAt)
  VALUES (1, 'INACTIVE', datetime('now'));
`;
