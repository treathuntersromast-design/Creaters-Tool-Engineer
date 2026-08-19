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
import { ClaudeCodeService } from '../claude/claudeCodeService';
import { AiClient } from '../ai/aiClient';
import { LessonsLearnedRepository } from '../db/repositories/lessonsLearnedRepository';
import { discoverRepositories } from '../git/repositoryDiscovery';
import { createProjectSlug } from '../utils/slugify';
import { generateRevision } from '../documents/documentGenerator';
import { buildMissingFieldsQuestion } from '../hearing/hearingQuestions';
import { parseHearingReply } from '../hearing/hearingParser';
import {
  checkWindowsUpdateStatus,
  pauseWindowsUpdate,
  isUpdateImminent,
  formatWuStatus,
} from '../system/windowsUpdateService';
import { takeScreenshot, pruneScreenshots } from '../system/screenshotService';
import { safeWorkspacePath } from '../utils/safePath';
import { SCREENSHOTS_DIR } from '../server';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

type HearingReplyCommand   = { type: 'HEARING_REPLY';   content: string; userId: string };
type ClaudeConfirmCommand  = { type: 'CLAUDE_CONFIRM';  content: string; userId: string };
type Command = LineCommand | HearingReplyCommand | ClaudeConfirmCommand;

const MAX_HISTORY = 6; // 直近3往復分

export class ProjectService {
  /** userId → [{role, content}, ...] 直近の会話履歴（インメモリ） */
  private readonly conversationHistory = new Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>();
  /** userId → 提案済みチーム構成（次回 NEW_PROJECT 時に使用） */
  private readonly pendingTeamByUser = new Map<string, Array<{ name: string; role: string }>>();
  /** userId → 連続 UNKNOWN カウント（自動改善提案のトリガー用） */
  private readonly unknownCountByUser = new Map<string, number>();
  /** 自動改善提案を出した userId のセット（同セッション内で重複させない） */
  private readonly autoImproveSentTo = new Set<string>();

  private addHistory(userId: string, role: 'user' | 'assistant', content: string): void {
    const hist = this.conversationHistory.get(userId) ?? [];
    hist.push({ role, content });
    if (hist.length > MAX_HISTORY) hist.splice(0, hist.length - MAX_HISTORY);
    this.conversationHistory.set(userId, hist);
  }

  private getHistory(userId: string): Array<{ role: 'user' | 'assistant'; content: string }> {
    return this.conversationHistory.get(userId) ?? [];
  }

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
    private readonly aiClient?: AiClient,
    private readonly claudeCodeService?: ClaudeCodeService,
    private readonly lessonsRepo?: LessonsLearnedRepository,
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
      case 'GIT_COMMIT':       return this.gitCommandService.handleCommit(command.userId, command.message);
      case 'GIT_MERGE':        return this.gitCommandService.handleMerge(command.branch, command.userId);
      // editor commands
      case 'EDITOR_OPEN':      return this.editorService.handleLaunch(command.userId, undefined, command.editorHint ?? undefined);
      case 'EDITOR_OPEN_REPO': return this.handleEditorOpenRepo(command.repoQuery, command.editorHint, command.userId);
      case 'EDITOR_STATUS':    return this.editorService.handleStatus(command.userId);
      // config commands
      case 'REPOS_PATH_SET':   return this.handleReposPathSet(command.paths, command.userId);
      case 'CONFIG_SHOW':      return this.handleConfigShow(command.userId);
      // repo analysis commands
      case 'REPO_ANALYZE':     return this.handleRepoAnalyze(command.query, command.userId);
      case 'FILE_LIST':        return this.handleFileList(command.userId);
      case 'FILE_READ':        return this.handleFileRead(command.filePath, command.userId);
      // repo creation
      case 'GIT_INIT':         return this.gitCommandService.handleInit(command.name, command.userId);
      // team composition
      case 'TEAM_PROPOSE':     return this.handleTeamPropose(command.description, command.userId);
      // Claude Code integration
      case 'CLAUDE_PLAN':      return this.handleClaudePlan(command.prompt, command.userId);
      case 'CLAUDE_CONFIRM':   return this.handleClaudeConfirm(command.content, command.userId);
      // フィードバック・自己改善
      case 'FEEDBACK':         return this.handleFeedback(command.description, command.userId);
      // スクリーンショット
      case 'SCREENSHOT':       return this.handleScreenshot(command.userId);
      // Windows Update
      case 'WU_CHECK':         return this.handleWuCheck(command.userId);
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

  isClaudePlanPending(userId: string): boolean {
    return this.claudeCodeService?.hasPendingPlan(userId) ?? false;
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

    // Pattern 4 – Memory + Dreaming: load lessons and include in kickoff message
    const lessons = this.lessonsRepo?.findRecent(5) ?? [];
    const leaderAgent = this.agentFactory.getLeaderAgent();
    const kickoffMsg = leaderAgent.buildKickoffMessage(name, lessons);
    await this.lineClient.sendPush(userId, kickoffMsg);

    // ── 自動チーム提案（pendingTeam があればそれを使い、なければ AI で生成）──
    let teamMembers: Array<{ name: string; role: string }>;
    const pendingTeam = this.pendingTeamByUser.get(userId);
    this.pendingTeamByUser.delete(userId);

    if (pendingTeam) {
      teamMembers = pendingTeam;
    } else if (this.aiClient) {
      try {
        const systemPrompt = [
          'あなたはソフトウェア開発プロジェクトのチームプランナーです。',
          '以下のプロジェクト名に基づき、最適なチーム構成を JSON 配列のみで返してください。',
          'チームは 5〜7 名で構成し、窓口担当（プロジェクトマネージャー）を必ず含めてください。',
          'メンバー名は「山田 Manager」のような形式にしてください。',
          'JSON 以外のテキストは絶対に含めないでください。',
          '返答形式: [{"name":"山田 Coordinator","role":"プロジェクトマネージャー（窓口担当）"},...]',
        ].join('\n');
        const raw = await this.aiClient.generate(systemPrompt, `プロジェクト名: ${name}`);
        const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        const parsed = JSON.parse(cleaned) as Array<{ name: string; role: string }>;
        teamMembers = parsed.filter((m) => typeof m.name === 'string' && typeof m.role === 'string').slice(0, 8);
        if (teamMembers.length === 0) throw new Error('empty team');
      } catch {
        teamMembers = this.agentFactory.getAllAgents().map((a) => ({ name: a.name, role: a.role }));
      }
    } else {
      teamMembers = this.agentFactory.getAllAgents().map((a) => ({ name: a.name, role: a.role }));
    }

    const slug = createProjectSlug(name);
    const workspacePath = this.workspaceService.createProjectWorkspace(slug);
    const project = this.projectRepo.create({ name, slug, userId, workspacePath });

    for (const member of teamMembers) {
      this.agentRepo.create({ projectId: project.id, name: member.name, role: member.role });
    }
    this.workspaceService.writeTeamJson(workspacePath, teamMembers);

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

    // チーム構成を送信
    const teamLines = ['🤖 チーム構成:', ''];
    teamMembers.forEach((m, i) => { teamLines.push(`${i + 1}. ${m.name}`); teamLines.push(`   役割: ${m.role}`); });
    await this.lineClient.sendPush(userId, teamLines.join('\n'));

    // ── 自動プラン提示 ──────────────────────────────────────────
    if (this.claudeCodeService) {
      const repoPath = this.getRepoPath();
      if (repoPath) {
        try {
          const planPrompt = `プロジェクト「${name}」の初期設計プランを作成してください。どのようなアーキテクチャ・技術スタック・主要機能・開発ステップが適切か、簡潔にプランを提示してください。`;
          await this.claudeCodeService.runPlan(repoPath, planPrompt, userId);
        } catch (err) {
          logger.warn('Auto plan proposal failed', { err: String(err) });
          await this.lineClient.sendPush(userId, '⚠️ 自動プラン提示に失敗しました。「プランモード: <指示>」で手動でプランを作成できます。');
        }
      } else {
        await this.lineClient.sendPush(userId,
          '📋 プラン作成: リポジトリを選択後「プランモード: プロジェクト設計プランを作成してください」でプランを作成できます。'
        );
      }
    }

    // ヒアリング開始
    await this.lineClient.sendPush(userId,
      `\n${this.agentFactory.getLeaderAgent().getHearingQuestions()}`
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
    this.addHistory(userId, 'user', raw);

    if (this.aiClient) {
      try {
        if (await this.handleWithAIClassification(raw, userId)) {
          this.unknownCountByUser.delete(userId); // AI が対応できた → リセット
          return;
        }
      } catch (err) {
        logger.warn('AI classification failed, falling back to command list', { err: String(err) });
      }
    }

    // 連続 UNKNOWN カウント
    const count = (this.unknownCountByUser.get(userId) ?? 0) + 1;
    this.unknownCountByUser.set(userId, count);

    // 3回連続で認識できない場合、自動改善提案（1セッション1回のみ）
    if (count >= 3 && !this.autoImproveSentTo.has(userId)) {
      this.autoImproveSentTo.add(userId);
      await this.lineClient.sendPush(userId,
        `💡 「${raw}」など、うまく認識できないメッセージが続いています。\n` +
        `このやり取りを元にアプリを改善しますか？\n\n` +
        `「改善: ${raw}のような操作ができるようにしてほしい」\n` +
        `のように送ると自動で修正プランを作成します。`,
      );
      return;
    }

    await this.lineClient.sendPush(userId, [
      'コマンドが認識できませんでした。',
      '',
      '【プロジェクト管理】',
      '・新規プロジェクト: <名前>',
      '・進捗 / 承認 / 修正: <内容>',
      '・停止 / 再開',
      '',
      '【Git 操作】',
      '・リポジトリ一覧 / <名前>を選択',
      '・新規リポジトリ: <名前>（新しいリポジトリを作成）',
      '・ステータス確認 / ログ確認',
      '・フェッチ / プル / プッシュ',
      '・ブランチ一覧 / <branch>に切り替え',
      '・差分確認',
      '',
      '【チーム】',
      '・チーム提案: <プロジェクト説明>（AIがチーム構成を提案）',
      '',
      '【Claude Code】',
      '・プランモード: <指示>（Claude Codeをプランモードで実行して結果をここへ送信）',
      '・コードの分析・修正は自然文でOK（例:「◯◯を修正して」→プラン提示→「はい」で実行）',
      '',
      '【エディター】',
      '・VSCodeを開いて / Cursorを開いて',
      '・{名前}をVSCodeで開いて',
      '',
      '【設定】',
      '・パス設定: <パス>',
      '・設定確認',
    ].join('\n'));
  }

  private async handleWithAIClassification(raw: string, userId: string): Promise<boolean> {
    const projectStatus = this.getUserProjectStatus(userId);
    const isHearing = projectStatus === 'HEARING';

    const systemPrompt = [
      'あなたはLINE AIディベロッパーオーケストレーターのアシスタントです。',
      'ユーザーのメッセージを解釈し、最適なアクションをJSONのみで返してください。',
      'JSON以外のテキストは絶対に含めないでください。',
      '',
      isHearing
        ? '【現在の状態】ユーザーはプロジェクトのヒアリング中です。'
        : '【現在の状態】通常操作モードです。',
      '',
      '【アクション一覧】',
      'NONE - 質問・依頼・雑談・説明・相談など（"response"に500文字以内の親切な日本語返答）。ヒアリング中でも「〜して」「〜できますか」「〜を確認して」のような依頼・質問はNONEで回答する。',
      isHearing
        ? 'HEARING_REPLY - ヒアリング項目への【直接回答のみ】（例：「目的はメモアプリです」「技術スタックはReact」など、質問・依頼・相談ではなく回答そのものを含む場合）'
        : '',
      'NEW_PROJECT - 新規プロジェクト作成（"name"にプロジェクト名）',
      'PROGRESS - 進捗確認',
      'APPROVE - 承認',
      'STOP - 停止',
      'RESUME - 再開',
      'GIT_LIST_REPOS - リポジトリ一覧を表示',
      'GIT_SELECT_REPO - リポジトリを選択（"query"にリポジトリ名）',
      'GIT_STATUS - Gitステータス確認',
      'GIT_LOG - コミットログ確認',
      'GIT_FETCH - フェッチ実行',
      'GIT_PULL - プル実行',
      'GIT_PUSH - プッシュ実行',
      'GIT_BRANCH_LIST - ブランチ一覧',
      'GIT_CHECKOUT - ブランチ切り替え（"branch"にブランチ名）',
      'GIT_DIFF - 差分確認',
      'GIT_CONFIRM - 確認/実行/はい',
      'GIT_CANCEL - キャンセル/いいえ',
      'EDITOR_OPEN - エディターを開く（"editorHint"にVSCode/Cursor/null）',
      'EDITOR_OPEN_REPO - リポジトリをエディターで開く（"repoQuery"にリポジトリ名、"editorHint"にVSCode/Cursor/null）',
      'EDITOR_STATUS - エディター状態確認',
      'CONFIG_SHOW - 設定確認',
      'REPOS_PATH_SET - リポジトリ検索パスを設定（"paths"にパス文字列）',
      'REPO_ANALYZE - Claude Code CLI がリポジトリのファイルを直接読んで質問に回答（"query"に質問内容）。「〜を確認して」「〜は揃ってますか」「〜を調べて」など読み取りのみの分析・確認依頼に使用。コード変更を伴う依頼は REPO_ANALYZE ではなく CLAUDE_PLAN を選ぶこと',
      'FILE_LIST - リポジトリ内のファイル一覧を表示',
      'FILE_READ - 特定ファイルの内容を表示（"filePath"にリポジトリルートからの相対パス）',
      'GIT_COMMIT - 変更をすべてステージ→コミット（"message"にコミット概要、省略可）。「コミットして」「コミット: バグ修正」などに使用',
      'GIT_MERGE - 指定ブランチをマージ（"branch"にブランチ名）。「mainをマージして」「マージ: develop」などに使用',
      'GIT_INIT - 新規リポジトリを作成（"name"にリポジトリ名）。「リポジトリを作成して」「新しいリポジトリ〜」などに使用',
      'TEAM_PROPOSE - AIがプロジェクトに最適なチーム構成を提案する（"description"にプロジェクト説明）。「チームを提案して」「チーム構成を考えて」などに使用',
      'CLAUDE_PLAN - Claude Code によるコードの修正・実装・機能追加・バグ修正・リファクタリング（"prompt"に指示内容をそのまま）。「〜を修正して」「〜を直して」「〜を実装して」「〜を追加して」「〜に変えて」などコード変更の依頼に使用。まず修正プランを提示し、ユーザーの「はい」確認後に実行される',
      'FEEDBACK - アプリの想定外の動作をフィードバックして自動改善プランを生成（"description"に問題の説明）。「改善:」「フィードバック:」「この返答は間違い」「この会話は想定外」などに使用',
      'SCREENSHOT - デスクトップのスクリーンショットを撮影してLINEへ送信。「スクリーンショット」「キャプチャ」「画面を撮って」などに使用',
      '',
      '【ボットの能力】Gitコマンド実行、リポジトリ選択、Claude Code CLI によるリポジトリの直接分析（REPO_ANALYZE: ファイルを実際に読んで回答）とコード修正（CLAUDE_PLAN: プラン提示→確認→実行）。分析・修正はこのボット自身が完結して実行できるため、VSCode/Cursor 等のエディターを開くよう誘導してはならない。エディター起動は明示的に要求された場合のみ EDITOR_OPEN を使う。',
      '',
      '【返答形式】JSONのみ（余分なテキスト不要）。例:',
      '{"type":"GIT_LIST_REPOS"}',
      '{"type":"GIT_SELECT_REPO","query":"Creancora"}',
      '{"type":"GIT_CHECKOUT","branch":"main"}',
      '{"type":"EDITOR_OPEN","editorHint":"VSCode"}',
      '{"type":"NONE","response":"リポジトリ一覧を確認するには「リポジトリ一覧」と送ってください。"}',
      '{"type":"GIT_COMMIT","message":"バグ修正"}',
      '{"type":"GIT_COMMIT","message":null}',
      '{"type":"GIT_MERGE","branch":"main"}',
      '{"type":"GIT_INIT","name":"my-new-repo"}',
      '{"type":"TEAM_PROPOSE","description":"クリエイターがAIを活用するマーケティングツール"}',
      '{"type":"CLAUDE_PLAN","prompt":"このリポジトリのアプリ設計プランを作成してください"}',
      '{"type":"CLAUDE_PLAN","prompt":"ログイン画面のバリデーションを修正して"}',
      '{"type":"FEEDBACK","description":"リポジトリ一覧を表示しようとしたがうまくいかなかった"}',
      '{"type":"SCREENSHOT"}',
      isHearing ? '{"type":"HEARING_REPLY"}' : '',
    ].filter(Boolean).join('\n');

    // セッション状態と会話履歴をユーザープロンプトに追記
    const session = this.gitCommandService.getSessionState();
    const history = this.getHistory(userId);
    const contextLines: string[] = [];
    if (session.selectedRepo) contextLines.push(`【選択中のリポジトリ】${session.selectedRepo}`);
    if (session.pendingAction) contextLines.push(`【確認待ちの操作】${session.pendingAction}`);
    if (history.length > 1) {
      contextLines.push('【直近の会話】');
      history.slice(0, -1).forEach((h) => {
        contextLines.push(`${h.role === 'user' ? 'ユーザー' : 'ボット'}: ${h.content}`);
      });
    }
    const contextBlock = contextLines.length > 0 ? contextLines.join('\n') + '\n\n' : '';
    const userPrompt = contextBlock + `ユーザー: ${raw}`;

    const jsonText = await this.aiClient!.generate(systemPrompt, userPrompt);

    let parsed: { type: string; [key: string]: unknown };
    try {
      const cleaned = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned) as { type: string; [key: string]: unknown };
    } catch {
      logger.warn('AI returned non-JSON response', { jsonText });
      return false;
    }

    switch (parsed.type) {
      case 'GIT_LIST_REPOS':
        await this.gitCommandService.handleListRepos(userId); return true;
      case 'GIT_SELECT_REPO':
        await this.gitCommandService.handleSelectRepo(String(parsed.query ?? ''), userId); return true;
      case 'GIT_STATUS':
        await this.gitCommandService.handleStatus(userId); return true;
      case 'GIT_LOG':
        await this.gitCommandService.handleLog(userId); return true;
      case 'GIT_FETCH':
        await this.gitCommandService.handleFetch(userId); return true;
      case 'GIT_PULL':
        await this.gitCommandService.handlePull(userId); return true;
      case 'GIT_PUSH':
        await this.gitCommandService.handlePush(userId); return true;
      case 'GIT_BRANCH_LIST':
        await this.gitCommandService.handleBranchList(userId); return true;
      case 'GIT_CHECKOUT':
        await this.gitCommandService.handleCheckout(String(parsed.branch ?? ''), userId); return true;
      case 'GIT_DIFF':
        await this.gitCommandService.handleDiff(userId); return true;
      case 'GIT_CONFIRM':
        await this.gitCommandService.handleConfirm(userId); return true;
      case 'GIT_CANCEL':
        await this.gitCommandService.handleCancel(userId); return true;
      case 'EDITOR_OPEN':
        await this.editorService.handleLaunch(userId, undefined, (parsed.editorHint as string | null) ?? undefined); return true;
      case 'EDITOR_OPEN_REPO':
        await this.handleEditorOpenRepo(String(parsed.repoQuery ?? ''), parsed.editorHint as string | null, userId); return true;
      case 'EDITOR_STATUS':
        await this.editorService.handleStatus(userId); return true;
      case 'CONFIG_SHOW':
        await this.handleConfigShow(userId); return true;
      case 'REPOS_PATH_SET':
        await this.handleReposPathSet(String(parsed.paths ?? ''), userId); return true;
      case 'REPO_ANALYZE':
        await this.handleRepoAnalyze(String(parsed.query ?? raw), userId); return true;
      case 'FILE_LIST':
        await this.handleFileList(userId); return true;
      case 'FILE_READ':
        await this.handleFileRead(String(parsed.filePath ?? ''), userId); return true;
      case 'GIT_COMMIT':
        await this.gitCommandService.handleCommit(userId, parsed.message ? String(parsed.message) : null); return true;
      case 'GIT_MERGE':
        await this.gitCommandService.handleMerge(String(parsed.branch ?? ''), userId); return true;
      case 'GIT_INIT':
        await this.gitCommandService.handleInit(String(parsed.name ?? ''), userId); return true;
      case 'TEAM_PROPOSE':
        await this.handleTeamPropose(String(parsed.description ?? ''), userId); return true;
      case 'CLAUDE_PLAN':
        await this.handleClaudePlan(String(parsed.prompt ?? 'このリポジトリのアプリ設計プランを作成してください'), userId); return true;
      case 'FEEDBACK':
        await this.handleFeedback(String(parsed.description ?? '直前の返答が想定外でした'), userId); return true;
      case 'SCREENSHOT':
        await this.handleScreenshot(userId); return true;
      case 'NEW_PROJECT':
        await this.handleNewProject(String(parsed.name ?? ''), userId, false); return true;
      case 'PROGRESS':
        await this.handleProgress(userId); return true;
      case 'APPROVE':
        await this.handleApprove(userId); return true;
      case 'STOP':
        await this.handleStop(userId); return true;
      case 'RESUME':
        await this.handleResume(userId); return true;
      case 'HEARING_REPLY':
        await this.handleHearingReply(raw, userId);
        return true;
      case 'NONE':
        if (parsed.response) {
          const reply = String(parsed.response).slice(0, 4500);
          this.addHistory(userId, 'assistant', reply);
          await this.lineClient.sendPush(userId, reply);
        }
        return true;
      default:
        return false;
    }
  }

  private getRepoPath(): string | null {
    const state = this.gitCommandService.getSessionState();
    if (!state.selectedRepo) return null;
    const match = state.selectedRepo.match(/\((.+)\)$/);
    return match?.[1] ?? null;
  }

  private async handleFileList(userId: string): Promise<void> {
    const repoPath = this.getRepoPath();
    if (!repoPath) {
      await this.lineClient.sendPush(userId, '先にリポジトリを選択してください。\n「リポジトリ一覧」で確認できます。');
      return;
    }
    const result = await this.gitCommandService.runCommand(repoPath, ['ls-files']);
    if (!result.ok) {
      await this.lineClient.sendPush(userId, `ファイル一覧の取得に失敗しました。\n${result.stderr}`);
      return;
    }
    const files = result.stdout.split('\n').filter(Boolean);
    const display = files.slice(0, 60).join('\n');
    const suffix = files.length > 60 ? `\n…他 ${files.length - 60} 件` : '';
    await this.lineClient.sendPush(userId, `📂 ファイル一覧（${files.length} 件）\n\n${display}${suffix}`);
  }

  private async handleFileRead(filePath: string, userId: string): Promise<void> {
    const repoPath = this.getRepoPath();
    if (!repoPath) {
      await this.lineClient.sendPush(userId, '先にリポジトリを選択してください。');
      return;
    }
    if (!filePath) {
      await this.lineClient.sendPush(userId, 'ファイルパスを指定してください。\n例:「README.mdを見せて」');
      return;
    }
    // path.resolve + path.relative でリポジトリ外への脱出（絶対パス・.. ・兄弟ディレクトリ）を確実に防ぐ。
    // 単純な startsWith 前方一致は C:\repo と C:\repo-secret を区別できず脆弱。
    let fullPath: string;
    try {
      fullPath = safeWorkspacePath(repoPath, filePath);
    } catch {
      await this.lineClient.sendPush(userId, '⚠️ 無効なパスです。リポジトリ内のファイルのみ参照できます。');
      return;
    }
    if (!fs.existsSync(fullPath)) {
      await this.lineClient.sendPush(userId, `ファイルが見つかりません: ${filePath}`);
      return;
    }
    const content = fs.readFileSync(fullPath, 'utf-8').slice(0, 3000);
    const stat = fs.statSync(fullPath);
    const truncated = stat.size > 3000 ? '\n\n…（長いため先頭3000文字のみ表示）' : '';
    await this.lineClient.sendPush(userId, `📄 ${filePath}\n\n${content}${truncated}`);
  }

  private async handleRepoAnalyze(query: string, userId: string): Promise<void> {
    const repoPath = this.getRepoPath();
    const state = this.gitCommandService.getSessionState();

    if (!repoPath) {
      await this.lineClient.sendPush(userId, '先にリポジトリを選択してください。\n「リポジトリ一覧」で確認できます。');
      return;
    }

    // Claude Code CLI があればファイルを直接読ませて回答する（進捗表示は runAnalyze 側が行う）。
    if (this.claudeCodeService) {
      const reply = await this.claudeCodeService.runAnalyze(repoPath, query, userId);
      if (reply !== null) {
        // 会話履歴の肥大を防ぐため先頭1000文字のみ保持する。
        this.addHistory(userId, 'assistant', reply.slice(0, 1000));
      }
      return;
    }

    // ── フォールバック: Claude Code CLI が無い場合のみ git 情報 + aiClient で分析 ──
    await this.lineClient.sendPush(userId, '🔍 リポジトリを分析中です...');

    const sections: string[] = [`【リポジトリ】${state.selectedRepo}`];

    // git status
    const statusResult = await this.gitCommandService.runCommand(repoPath, ['status', '--short']);
    sections.push(`\n【git status】\n${statusResult.stdout || '変更なし'}`);

    // git log (直近10件)
    const logResult = await this.gitCommandService.runCommand(repoPath, ['log', '--oneline', '-10']);
    if (logResult.ok) sections.push(`\n【直近コミット】\n${logResult.stdout}`);

    // git branch
    const branchResult = await this.gitCommandService.runCommand(repoPath, ['branch', '-a']);
    if (branchResult.ok) sections.push(`\n【ブランチ一覧】\n${branchResult.stdout}`);

    // ファイル一覧
    const lsResult = await this.gitCommandService.runCommand(repoPath, ['ls-files']);
    if (lsResult.ok) {
      const files = lsResult.stdout.split('\n').filter(Boolean);
      sections.push(`\n【ファイル一覧（${files.length}件）】\n${files.slice(0, 80).join('\n')}`);
    }

    // 主要ファイルの内容
    for (const keyFile of ['README.md', 'package.json', 'package-lock.json'].slice(0, 2)) {
      const fp = path.join(repoPath, keyFile);
      if (fs.existsSync(fp)) {
        const content = fs.readFileSync(fp, 'utf-8').slice(0, 1500);
        sections.push(`\n【${keyFile}】\n${content}`);
      }
    }

    if (!this.aiClient) {
      await this.lineClient.sendPush(userId, sections.join('\n').slice(0, 4500));
      return;
    }

    const systemPrompt = [
      'あなたはソフトウェア開発の専門家です。',
      'ユーザーに提供されたリポジトリ情報を分析し、質問に対して日本語で具体的に回答してください（500文字以内）。',
      '実際のデータのみを根拠にし、不明な点は正直に伝えてください。',
    ].join('\n');

    const reply = await this.aiClient.generate(systemPrompt, `${sections.join('\n')}\n\n質問: ${query}`);
    this.addHistory(userId, 'assistant', reply);
    await this.lineClient.sendPush(userId, reply.slice(0, 4500));
  }

  private async handleTeamPropose(description: string, userId: string): Promise<void> {
    const desc = description || 'AIを活用したソフトウェア開発プロジェクト';

    if (!this.aiClient) {
      const defaultTeam = this.agentFactory.getAllAgents().map((a) => ({ name: a.name, role: a.role }));
      this.pendingTeamByUser.set(userId, defaultTeam);
      const lines = ['🤖 チーム構成（デフォルト）:', ''];
      defaultTeam.forEach((m, i) => lines.push(`${i + 1}. ${m.name}（${m.role}）`));
      lines.push('', '「新規プロジェクト: <名前>」でこのチームを使います。');
      await this.lineClient.sendPush(userId, lines.join('\n'));
      return;
    }

    await this.lineClient.sendPush(userId, '🤖 チーム構成を考えています...');

    const systemPrompt = [
      'あなたはソフトウェア開発プロジェクトのチームプランナーです。',
      '以下のプロジェクト説明に基づき、最適なチーム構成を JSON 配列のみで返してください。',
      'チームは 5〜7 名で構成してください。',
      '窓口担当（プロジェクトマネージャー）を必ず含めてください。',
      'メンバー名は「山田 Manager」「鈴木 Engineer」のような形式にしてください。',
      'JSON 以外のテキストは絶対に含めないでください。',
      '',
      '返答形式:',
      '[{"name":"山田 Coordinator","role":"プロジェクトマネージャー（窓口担当）"},{"name":"佐藤 Analyst","role":"要件定義・分析担当"},...]',
    ].join('\n');

    let team: Array<{ name: string; role: string }>;
    try {
      const raw = await this.aiClient.generate(systemPrompt, `プロジェクト説明: ${desc}`);
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned) as Array<{ name: string; role: string }>;
      team = parsed.filter((m) => typeof m.name === 'string' && typeof m.role === 'string').slice(0, 8);
      if (team.length === 0) throw new Error('empty team');
    } catch {
      team = this.agentFactory.getAllAgents().map((a) => ({ name: a.name, role: a.role }));
    }

    this.pendingTeamByUser.set(userId, team);

    const lines = ['🤖 提案チーム構成:', ''];
    team.forEach((m, i) => {
      lines.push(`${i + 1}. ${m.name}`);
      lines.push(`   役割: ${m.role}`);
    });
    lines.push('');
    lines.push('「新規プロジェクト: <名前>」でこのチームを使います。');
    lines.push('変更希望は「チーム提案: <説明>」で再提案できます。');

    await this.lineClient.sendPush(userId, lines.join('\n'));
    logger.info('Team proposed', { userId, count: team.length });
  }

  private async handleClaudePlan(prompt: string, userId: string): Promise<void> {
    const repoPath = this.getRepoPath();
    if (!repoPath) {
      await this.lineClient.sendPush(userId,
        '先にリポジトリを選択してください。\n「リポジトリ一覧」で確認できます。',
      );
      return;
    }

    if (!this.claudeCodeService) {
      await this.lineClient.sendPush(userId,
        '⚠️ Claude Code サービスが初期化されていません。\nサーバーを再起動してください。',
      );
      return;
    }

    await this.claudeCodeService.runPlan(repoPath, prompt, userId);
  }

  private async handleClaudeConfirm(content: string, userId: string): Promise<void> {
    if (!this.claudeCodeService) {
      await this.lineClient.sendPush(userId, '⚠️ Claude Code サービスが初期化されていません。');
      return;
    }
    await this.claudeCodeService.handleConfirmOrRewrite(content, userId);
  }

  private async handleFeedback(description: string, userId: string): Promise<void> {
    await this.lineClient.sendPush(userId, '🔍 会話を分析して改善プランを作成しています...');

    // 直近の会話履歴を収集
    const history = this.getHistory(userId);
    const historyText = history.length > 0
      ? history.map((h) => `${h.role === 'user' ? 'ユーザー' : 'ボット'}: ${h.content}`).join('\n')
      : '（履歴なし）';

    if (!this.claudeCodeService) {
      await this.lineClient.sendPush(userId,
        '⚠️ Claude Code サービスが初期化されていません。\nサーバーを再起動してください。',
      );
      return;
    }

    // このアプリ自身のソースリポジトリパスで Claude Code を実行する。
    // EXE 実行時など process.cwd() がソースと異なる場合は SELF_REPO_PATH で明示指定する。
    const selfRepoPath = process.env['SELF_REPO_PATH'] ?? process.cwd();
    if (!fs.existsSync(path.join(selfRepoPath, 'package.json'))) {
      await this.lineClient.sendPush(userId,
        '⚠️ アプリのソースリポジトリを特定できませんでした。環境変数 SELF_REPO_PATH にソースのパスを設定してください。',
      );
      return;
    }

    const prompt = [
      'このLINEボットアプリ（Creaters Tool Engineer）で想定外の会話が発生しました。',
      'コードを分析し、改善プランを日本語で提示してください。',
      '',
      '【問題の説明】',
      description,
      '',
      '【直近の会話履歴】',
      historyText,
      '',
      '【分析・改善の観点】',
      '1. src/line/messageParser.ts に新しいコマンドパターンを追加すべきか',
      '2. src/core/projectService.ts に新しいハンドラーを追加すべきか',
      '3. handleWithAIClassification の AI 分類プロンプトを改善すべきか',
      '4. src/line/localChatRouter.ts や他のファイルに変更が必要か',
      '',
      '具体的にどのファイルのどの部分をどう変更すればよいかを提示してください。',
      'ユーザーが「はい」で承認すると、そのままこのリポジトリに変更が適用されます。',
    ].join('\n');

    // 改善対象はアプリ自身のソース。プラン提示 → ユーザー確認 → 実行のフローで自アプリも修正できる。
    // LINE 経由実行に対する防御線（セッション認証+OTP / commandFilter / Bash 不許可 / 確認フロー）は
    // claudeCodeService.runPlan 側のコメントを参照。
    this.unknownCountByUser.delete(userId); // 改善プラン作成でリセット
    await this.claudeCodeService.runPlan(selfRepoPath, prompt, userId);
    logger.info('Feedback improvement plan triggered', { userId, description });
  }

  private async handleScreenshot(userId: string): Promise<void> {
    await this.lineClient.sendPush(userId, '📸 スクリーンショットを撮影しています...');

    pruneScreenshots(SCREENSHOTS_DIR);
    const result = await takeScreenshot(SCREENSHOTS_DIR);

    if (!result.ok) {
      await this.lineClient.sendPush(userId, `❌ 撮影に失敗しました。\n${result.error ?? '不明なエラー'}`);
      return;
    }

    // ngrok ドメインが設定されていれば LINE へ画像送信、なければローカルパスを通知
    const domain = process.env['NGROK_DOMAIN'];
    if (domain) {
      const imageUrl = `https://${domain}/screenshots/${result.filename}`;
      await this.lineClient.sendImage(userId, imageUrl, imageUrl, result.filePath);
    } else {
      await this.lineClient.sendImage(userId, '', '', result.filePath);
      // ngrok 未設定の場合は追加でテキスト案内
      await this.lineClient.sendPush(userId,
        '⚠️ ngrok が未設定のため LINE への画像送信はできません。\n' +
        'PC アプリから確認するか、.env に NGROK_DOMAIN を設定してください。',
      );
    }

    logger.info('Screenshot taken', { userId, path: result.filePath });
  }

  private async handleWuCheck(userId: string): Promise<void> {
    await this.lineClient.sendPush(userId, '🔍 Windows Update の状況を確認しています...');
    try {
      const status = await checkWindowsUpdateStatus();

      if (!status.isWindows) {
        await this.lineClient.sendPush(userId, formatWuStatus(status));
        return;
      }

      // アップデートが迫っている場合は自動的に1週間延長
      if (isUpdateImminent(status) && !status.pauseExpiry) {
        const pauseResult = await pauseWindowsUpdate(7);
        await this.lineClient.sendPush(userId, formatWuStatus(status, pauseResult));
      } else {
        await this.lineClient.sendPush(userId, formatWuStatus(status));
      }
    } catch (err) {
      logger.error('WU check failed', { err: String(err) });
      await this.lineClient.sendPush(userId, `❌ 確認中にエラーが発生しました: ${String(err).slice(0, 200)}`);
    }
  }

  private async handleReposPathSet(paths: string, userId: string): Promise<void> {
    // ユーザー入力を検証: 絶対パスの実在ディレクトリのみ許可。
    // 未検証だと C:\Users などを指定してマシン上の任意リポジトリを列挙・選択できてしまう。
    const parts = paths.split(';').map((p) => p.trim()).filter(Boolean);
    const invalid = parts.filter(
      (p) => !path.isAbsolute(p) || p.includes('..') ||
             !(fs.existsSync(p) && fs.statSync(p).isDirectory()),
    );

    if (parts.length === 0 || invalid.length > 0) {
      await this.lineClient.sendPush(userId, [
        '❌ 無効なパスです。実在する絶対パスのフォルダのみ指定できます。',
        invalid.length > 0 ? `\n問題のあるパス:\n${invalid.join('\n')}` : '',
        '\n例:「パス設定: D:\\Project」（複数はセミコロン区切り）',
      ].filter(Boolean).join('\n'));
      return;
    }

    const normalized = parts.join(';');
    process.env['GIT_REPOS_PATHS'] = normalized;
    this.gitCommandService.invalidateCache();
    const envFilePath = process.env['ENV_FILE_PATH'] ?? '不明';
    await this.lineClient.sendPush(userId, [
      '✅ リポジトリ検索パスを設定しました（今回起動中のみ有効）。',
      '',
      `設定値: ${normalized}`,
      '',
      '永続化するには設定ファイルに追記してください:',
      `📄 ${envFilePath}`,
      `GIT_REPOS_PATHS=${normalized}`,
    ].join('\n'));
  }

  private async handleConfigShow(userId: string): Promise<void> {
    const envFilePath = process.env['ENV_FILE_PATH'] ?? '不明（開発モード）';
    const reposPaths  = process.env['GIT_REPOS_PATHS'] ?? '未設定';
    await this.lineClient.sendPush(userId, [
      '⚙️ 設定情報',
      '',
      `設定ファイル:`,
      `📄 ${envFilePath}`,
      '',
      `リポジトリ検索パス:`,
      reposPaths,
      '',
      'パス変更: 「パス設定: D:\\Project」',
    ].join('\n'));
  }
}
