import { ProjectRepository } from '../db/repositories/projectRepository';
import { MessageRepository } from '../db/repositories/messageRepository';
import { AgentRepository } from '../db/repositories/agentRepository';
import { ApprovalRepository } from '../db/repositories/approvalRepository';
import { WebhookEventRepository } from '../db/repositories/webhookEventRepository';
import { HearingAnswerRepository, getMissingFields } from '../db/repositories/hearingAnswerRepository';
import { WorkspaceService } from './workspaceService';
import { WorkflowRunner } from './workflowRunner';
import { WorkflowService } from './workflowService';
import { StateMachine } from './stateMachine';
import { AgentFactory } from '../agents/AgentFactory';
import { LineClient } from '../line/lineClient';
import { LineCommand } from '../line/messageParser';
import { LineEvent } from '../line/lineTypes';
import { GitCommandService } from '../git/gitCommandService';
import { EditorService } from '../editor/editorService';
import { discoverRepositories } from '../git/repositoryDiscovery';
import { createProjectSlug } from '../utils/slugify';
import { generateRevision } from '../documents/documentGenerator';
import { buildMissingFieldsQuestion } from '../hearing/hearingQuestions';
import { parseHearingReply } from '../hearing/hearingParser';
import { logger } from '../utils/logger';

type HearingReplyCommand = { type: 'HEARING_REPLY'; content: string; userId: string };
type Command = LineCommand | HearingReplyCommand;

export class ProjectService {
  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly messageRepo: MessageRepository,
    private readonly agentRepo: AgentRepository,
    private readonly approvalRepo: ApprovalRepository,
    private readonly webhookEventRepo: WebhookEventRepository,
    private readonly hearingAnswerRepo: HearingAnswerRepository,
    private readonly workspaceService: WorkspaceService,
    private readonly workflowRunner: WorkflowRunner,
    private readonly workflowService: WorkflowService,
    private readonly stateMachine: StateMachine,
    private readonly agentFactory: AgentFactory,
    private readonly lineClient: LineClient,
    private readonly gitCommandService: GitCommandService,
    private readonly editorService: EditorService,
  ) {}

  async handleCommand(command: Command): Promise<void> {
    switch (command.type) {
      case 'NEW_PROJECT':       return this.handleNewProject(command.name, command.userId, false);
      case 'NEW_PROJECT_FORCE': return this.handleNewProject(command.name, command.userId, true);
      case 'HEARING_REPLY':     return this.handleHearingReply(command.content, command.userId);
      case 'PROGRESS':          return this.handleProgress(command.userId);
      case 'APPROVE':           return this.handleApprove(command.userId);
      case 'MODIFY':            return this.handleModify(command.content, command.userId);
      case 'STOP':              return this.handleStop(command.userId);
      case 'RESUME':            return this.handleResume(command.userId);
      // git commands
      case 'GIT_LIST_REPOS':   return this.gitCommandService.handleListRepos(command.userId);
      case 'GIT_SELECT_REPO':  return this.gitCommandService.handleSelectRepo(command.query, command.userId);
      case 'GIT_STATUS':       return this.gitCommandService.handleStatus(command.userId);
      case 'GIT_LOG':          return this.gitCommandService.handleLog(command.userId);
      case 'GIT_FETCH':        return this.gitCommandService.handleFetch(command.userId);
      case 'GIT_PULL':         return this.gitCommandService.handlePull(command.userId);
      case 'GIT_PUSH':         return this.gitCommandService.handlePush(command.userId);
      case 'GIT_BRANCH_LIST':  return this.gitCommandService.handleBranchList(command.userId);
      case 'GIT_CHECKOUT':     return this.gitCommandService.handleCheckout(command.branch, command.userId);
      case 'GIT_DIFF':         return this.gitCommandService.handleDiff(command.userId);
      case 'GIT_CONFIRM':      return this.gitCommandService.handleConfirm(command.userId);
      case 'GIT_CANCEL':       return this.gitCommandService.handleCancel(command.userId);
      // editor commands
      case 'EDITOR_OPEN':      return this.editorService.handleLaunch(command.userId, undefined, command.editorHint ?? undefined);
      case 'EDITOR_OPEN_REPO': return this.handleEditorOpenRepo(command.repoQuery, command.editorHint, command.userId);
      case 'EDITOR_STATUS':    return this.editorService.handleStatus(command.userId);
      case 'UNKNOWN':           return this.handleUnknown(command.raw, command.userId);
    }
  }

  async handleWebhookEvent(event: LineEvent, eventId: string): Promise<{ isDuplicate: boolean }> {
    const { inserted } = this.webhookEventRepo.insertOrIgnore({
      lineWebhookEventId: eventId,
      lineMessageId: event.message?.id ?? null,
      userId: event.source.userId ?? null,
      eventType: event.type,
      isRedelivery: event.deliveryContext?.isRedelivery ?? false,
    });
    return { isDuplicate: !inserted };
  }

  getUserProjectStatus(userId: string): string | null {
    const project = this.projectRepo.findActiveByUserId(userId);
    return project?.status ?? null;
  }

  private async handleNewProject(name: string, userId: string, force: boolean): Promise<void> {
    const existing = this.projectRepo.findActiveByUserId(userId);

    if (existing && !force) {
      await this.lineClient.sendPush(userId,
        `既存のプロジェクト「${existing.name}」が進行中です。\n` +
        `強制作成する場合は「新規プロジェクト!: ${name}」と送ってください。`
      );
      return;
    }

    if (existing && force) {
      this.projectRepo.updateStatus(existing.id, 'STOPPED', existing.status);
      this.projectRepo.setActive(existing.id, false);
      logger.info('Force-stopped existing project', { projectId: existing.id });
    }

    const slug = createProjectSlug(name);
    const workspacePath = this.workspaceService.createProjectWorkspace(slug);
    const project = this.projectRepo.create({ name, slug, userId, workspacePath });

    // Create agent records
    const agents = this.agentFactory.getAllAgents();
    for (const agent of agents) {
      this.agentRepo.create({ projectId: project.id, name: agent.name, role: agent.role });
    }

    this.workspaceService.writeTeamJson(
      workspacePath,
      agents.map((a) => ({ name: a.name, role: a.role }))
    );

    this.projectRepo.updateStatus(project.id, 'HEARING');
    this.workspaceService.updateProjectState(workspacePath, {
      projectId: project.id,
      name: project.name,
      status: 'HEARING',
      revisionNumber: 0,
      hearingAnswers: {},
      generatedFiles: this.workspaceService.listFiles(workspacePath),
      updatedAt: new Date().toISOString(),
    });

    await this.lineClient.sendPush(userId,
      `✨ プロジェクト「${name}」を作成しました！\n\n` +
      this.agentFactory.getLeaderAgent().getHearingQuestions()
    );

    this.messageRepo.create({
      projectId: project.id,
      userId,
      direction: 'OUTBOUND',
      content: 'ヒアリング開始',
    });
  }

  private async handleHearingReply(content: string, userId: string): Promise<void> {
    const project = this.projectRepo.findActiveByUserId(userId);

    if (!project || project.status !== 'HEARING') {
      await this.lineClient.sendPush(userId, 'ヒアリング中のプロジェクトがありません。');
      return;
    }

    this.messageRepo.create({
      projectId: project.id,
      userId,
      direction: 'INBOUND',
      content,
    });

    const parsed = parseHearingReply(content);
    const updated = this.hearingAnswerRepo.upsert({ projectId: project.id, ...parsed });
    const missing = getMissingFields(updated);

    this.workspaceService.updateProjectState(project.workspacePath, {
      projectId: project.id,
      name: project.name,
      status: project.status,
      revisionNumber: project.revisionNumber,
      hearingAnswers: Object.fromEntries(
        Object.entries(updated).filter(([k]) => !['id', 'projectId', 'updatedAt'].includes(k))
      ),
      generatedFiles: this.workspaceService.listFiles(project.workspacePath),
      updatedAt: new Date().toISOString(),
    });

    if (missing.length > 0) {
      await this.lineClient.sendPush(userId, buildMissingFieldsQuestion(missing));
      return;
    }

    await this.lineClient.sendPush(userId,
      'ありがとうございます！すべての情報を確認しました。\n開発を開始します...'
    );

    this.projectRepo.updateStatus(project.id, 'REQUIREMENTS');
    this.workflowRunner.run(project.id);
  }

  private async handleProgress(userId: string): Promise<void> {
    const project = this.projectRepo.findActiveByUserId(userId);

    if (!project) {
      await this.lineClient.sendPush(userId, '進行中のプロジェクトはありません。\n「新規プロジェクト: <名前>」で開始できます。');
      return;
    }

    const hearingAnswers = this.hearingAnswerRepo.findByProjectId(project.id);
    const missing = hearingAnswers ? getMissingFields(hearingAnswers) : ['全項目'];
    const files = this.workspaceService.listFiles(project.workspacePath);

    const lines = [
      `📊 プロジェクト: ${project.name}`,
      `状態: ${project.status}`,
      `リビジョン: ${project.revisionNumber}`,
      '',
    ];

    if (project.status === 'HEARING' && missing.length > 0) {
      lines.push(`未回答項目: ${missing.join(', ')}`);
      lines.push('');
    }

    if (files.length > 0) {
      lines.push('生成済みファイル:');
      files.slice(0, 8).forEach((f) => lines.push(`  - ${f}`));
      if (files.length > 8) lines.push(`  ... 他${files.length - 8}件`);
    }

    await this.lineClient.sendPush(userId, lines.join('\n'));
  }

  private async handleApprove(userId: string): Promise<void> {
    const project = this.projectRepo.findActiveByUserId(userId);

    if (!project) {
      await this.lineClient.sendPush(userId, '進行中のプロジェクトがありません。');
      return;
    }

    if (project.status !== 'WAITING_APPROVAL') {
      await this.lineClient.sendPush(userId,
        `現在は承認できません。\n現在の状態: ${project.status}`
      );
      return;
    }

    this.approvalRepo.create({
      projectId: project.id,
      type: 'FINAL',
      status: 'APPROVED',
      comment: '承認されました',
    });

    this.projectRepo.setCompleted(project.id);
    this.workspaceService.updateProjectState(project.workspacePath, {
      projectId: project.id,
      name: project.name,
      status: 'COMPLETED',
      revisionNumber: project.revisionNumber,
      hearingAnswers: {},
      generatedFiles: this.workspaceService.listFiles(project.workspacePath),
      updatedAt: new Date().toISOString(),
    });

    await this.lineClient.sendPush(userId,
      `✅ プロジェクト「${project.name}」が完了しました！\n` +
      `お疲れ様でした。`
    );
  }

  private async handleModify(content: string, userId: string): Promise<void> {
    const project = this.projectRepo.findActiveByUserId(userId);

    const completedProject = !project
      ? this.projectRepo.findByUserId(userId).find((p) => p.status === 'COMPLETED')
      : project;

    const target = project?.status === 'WAITING_APPROVAL' || project?.status === 'COMPLETED'
      ? project
      : completedProject;

    if (!target) {
      await this.lineClient.sendPush(userId,
        '修正できるプロジェクトがありません。\n「承認」後または承認待ち状態でのみ修正できます。'
      );
      return;
    }

    if (target.status !== 'WAITING_APPROVAL' && target.status !== 'COMPLETED') {
      await this.lineClient.sendPush(userId,
        `現在は修正できません。\n現在の状態: ${target.status}`
      );
      return;
    }

    const newRevision = this.projectRepo.incrementRevision(target.id);

    const revisionDoc = generateRevision(content, newRevision);
    this.workspaceService.writeFile(target.workspacePath, revisionDoc.path, revisionDoc.content);

    this.approvalRepo.create({
      projectId: target.id,
      type: 'REVISION',
      status: 'PENDING',
      comment: content,
    });

    if (target.status === 'COMPLETED') {
      this.projectRepo.setActive(target.id, true);
    }

    this.projectRepo.updateStatus(target.id, 'REVISION_REQUESTED');
    this.workspaceService.updateProjectState(target.workspacePath, {
      projectId: target.id,
      name: target.name,
      status: 'REVISION_REQUESTED',
      revisionNumber: newRevision,
      hearingAnswers: {},
      generatedFiles: this.workspaceService.listFiles(target.workspacePath),
      updatedAt: new Date().toISOString(),
    });

    await this.lineClient.sendPush(userId,
      `📝 修正依頼 #${newRevision} を受け付けました。\n内容: ${content}\n\n要件定義から再実行します...`
    );

    this.projectRepo.updateStatus(target.id, 'REQUIREMENTS');
    this.workflowRunner.run(target.id);
  }

  private async handleStop(userId: string): Promise<void> {
    const project = this.projectRepo.findActiveByUserId(userId);

    if (!project) {
      await this.lineClient.sendPush(userId, '停止できるプロジェクトがありません。');
      return;
    }

    if (!this.stateMachine.canStop(project.status)) {
      await this.lineClient.sendPush(userId,
        `現在の状態では停止できません。\n現在の状態: ${project.status}`
      );
      return;
    }

    this.projectRepo.updateStatus(project.id, 'STOPPED', project.status);
    this.workspaceService.updateProjectState(project.workspacePath, {
      projectId: project.id,
      name: project.name,
      status: 'STOPPED',
      revisionNumber: project.revisionNumber,
      hearingAnswers: {},
      generatedFiles: this.workspaceService.listFiles(project.workspacePath),
      updatedAt: new Date().toISOString(),
    });

    await this.lineClient.sendPush(userId,
      `⏸️ プロジェクト「${project.name}」を停止しました。\n「再開」で再開できます。`
    );
  }

  private async handleResume(userId: string): Promise<void> {
    const project = this.projectRepo.findByUserId(userId).find((p) => p.status === 'STOPPED');

    if (!project) {
      await this.lineClient.sendPush(userId, '再開できるプロジェクトがありません。');
      return;
    }

    if (!this.stateMachine.canResume(project.status, project.previousStatus)) {
      await this.lineClient.sendPush(userId,
        `このプロジェクトは再開できません。\n以前の状態: ${project.previousStatus ?? '不明'}`
      );
      return;
    }

    const resumeStatus = project.previousStatus as typeof project.status ?? 'HEARING';
    this.projectRepo.setActive(project.id, true);
    this.projectRepo.updateStatus(project.id, resumeStatus);
    this.projectRepo.clearPreviousStatus(project.id);
    this.workspaceService.updateProjectState(project.workspacePath, {
      projectId: project.id,
      name: project.name,
      status: resumeStatus,
      revisionNumber: project.revisionNumber,
      hearingAnswers: {},
      generatedFiles: this.workspaceService.listFiles(project.workspacePath),
      updatedAt: new Date().toISOString(),
    });

    await this.lineClient.sendPush(userId,
      `▶️ プロジェクト「${project.name}」を再開しました。\n状態: ${resumeStatus}`
    );

    if (resumeStatus !== 'HEARING' && resumeStatus !== 'WAITING_APPROVAL') {
      this.workflowRunner.run(project.id);
    }
  }

  private async handleEditorOpenRepo(query: string, editorHint: string | null, userId: string): Promise<void> {
    const repos = discoverRepositories();
    const q = query.toLowerCase();
    const found = repos.find(
      (r) => r.name.toLowerCase() === q || r.name.toLowerCase().includes(q),
    );

    if (!found) {
      await this.lineClient.sendPush(
        userId,
        `❌ 「${query}」に一致するリポジトリが見つかりませんでした。\n` +
        `「リポジトリ一覧」で確認してください。`,
      );
      return;
    }

    await this.editorService.handleLaunch(userId, found.path, editorHint ?? undefined);
  }

  private async handleUnknown(raw: string, userId: string): Promise<void> {
    logger.debug('Unknown command', { raw, userId });
    await this.lineClient.sendPush(userId, [
      'コマンドが認識できませんでした。',
      '',
      '【プロジェクト管理】',
      '・新規プロジェクト: <名前>',
      '・進捗',
      '・承認',
      '・修正: <内容>',
      '・停止 / 再開',
      '',
      '【Git 操作】',
      '・リポジトリ一覧',
      '・<名前>を選択',
      '・ステータス確認',
      '・ログ確認',
      '・フェッチ / プル',
      '・プッシュ（確認あり）',
      '・ブランチ一覧',
      '・<branch>に切り替え',
      '・差分確認',
      '',
      '【エディター】',
      '・VSCodeを開いて / Cursorを開いて',
      '・{名前}をVSCodeで開いて',
      '・エディター確認',
    ].join('\n'));
  }
}
