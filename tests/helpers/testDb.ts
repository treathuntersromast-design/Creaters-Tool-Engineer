import Database from 'better-sqlite3';
import { runMigrations } from '../../src/db/migrations';
import { ProjectRepository } from '../../src/db/repositories/projectRepository';
import { MessageRepository } from '../../src/db/repositories/messageRepository';
import { AgentRepository } from '../../src/db/repositories/agentRepository';
import { TaskRepository } from '../../src/db/repositories/taskRepository';
import { DocumentRepository } from '../../src/db/repositories/documentRepository';
import { ApprovalRepository } from '../../src/db/repositories/approvalRepository';
import { WebhookEventRepository } from '../../src/db/repositories/webhookEventRepository';
import { WorkflowRunRepository } from '../../src/db/repositories/workflowRunRepository';
import { HearingAnswerRepository } from '../../src/db/repositories/hearingAnswerRepository';

export interface TestRepos {
  db: Database.Database;
  projectRepo: ProjectRepository;
  messageRepo: MessageRepository;
  agentRepo: AgentRepository;
  taskRepo: TaskRepository;
  documentRepo: DocumentRepository;
  approvalRepo: ApprovalRepository;
  webhookEventRepo: WebhookEventRepository;
  workflowRunRepo: WorkflowRunRepository;
  hearingAnswerRepo: HearingAnswerRepository;
}

export function createTestDb(): TestRepos {
  const db = new Database(':memory:');
  runMigrations(db);

  return {
    db,
    projectRepo:      new ProjectRepository(db),
    messageRepo:      new MessageRepository(db),
    agentRepo:        new AgentRepository(db),
    taskRepo:         new TaskRepository(db),
    documentRepo:     new DocumentRepository(db),
    approvalRepo:     new ApprovalRepository(db),
    webhookEventRepo: new WebhookEventRepository(db),
    workflowRunRepo:  new WorkflowRunRepository(db),
    hearingAnswerRepo: new HearingAnswerRepository(db),
  };
}

export function makeProject(repos: TestRepos, overrides: {
  name?: string;
  slug?: string;
  userId?: string;
  workspacePath?: string;
} = {}) {
  return repos.projectRepo.create({
    name:          overrides.name ?? 'Test Project',
    slug:          overrides.slug ?? `test-slug-${Date.now()}`,
    userId:        overrides.userId ?? 'U_test_user',
    workspacePath: overrides.workspacePath ?? '/tmp/test-workspace',
  });
}

export function makeHearingAnswers(repos: TestRepos, projectId: string) {
  return repos.hearingAnswerRepo.upsert({
    projectId,
    purpose:          'ToDoリスト管理アプリ',
    targetUsers:      '一般ユーザー',
    requiredFeatures: 'タスク追加・削除・完了',
    screens:          'あり',
    techStack:        'React + TypeScript',
    priority:         '1ヶ月以内',
    deployment:       'Vercel',
    testScope:        '単体テストのみ',
    rawText:          'all answers',
  });
}
