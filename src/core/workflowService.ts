import { ProjectRepository } from '../db/repositories/projectRepository';
import { TaskRepository } from '../db/repositories/taskRepository';
import { AgentRepository } from '../db/repositories/agentRepository';
import { DocumentRepository } from '../db/repositories/documentRepository';
import { HearingAnswerRepository } from '../db/repositories/hearingAnswerRepository';
import { LessonsLearnedRepository } from '../db/repositories/lessonsLearnedRepository';
import { WorkspaceService } from './workspaceService';
import { LineClient } from '../line/lineClient';
import { StateMachine } from './stateMachine';
import { AgentFactory } from '../agents/AgentFactory';
import { AgentContext, AgentResult, ArchitectureContext } from '../agents/Agent';
import { logger } from '../utils/logger';
import {
  generateRequirementsExcel,
  generateBasicDesignExcel,
  generateDetailedDesignExcel,
  generateTestSpecExcel,
  generateManualTestSpecExcel,
  generateIssueListExcel,
  generateScreenDesignExcel,
} from '../documents/excelService';

/** Issue 5 fix: 型安全な architectureContext 抽出 */
function extractArchitectureContext(data: unknown): ArchitectureContext | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const d = data as Record<string, unknown>;
  if (typeof d['architectureContext'] !== 'object' || d['architectureContext'] === null) return undefined;
  const ctx = d['architectureContext'] as Record<string, unknown>;
  if (typeof ctx['decisions'] !== 'string' || typeof ctx['techStack'] !== 'string') return undefined;
  return d['architectureContext'] as ArchitectureContext;
}

export function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 500);
}

/** Pattern 2 – Outcomes Loop: max automatic retries before giving up */
const MAX_IMPL_RETRIES = 2;

/** Pattern 2 – Outcomes Loop: minimum acceptable review score */
const MIN_SCORE_THRESHOLD = 80;

export class WorkflowService {
  constructor(
    private readonly projectRepo: ProjectRepository,
    private readonly taskRepo: TaskRepository,
    private readonly agentRepo: AgentRepository,
    private readonly documentRepo: DocumentRepository,
    private readonly hearingAnswerRepo: HearingAnswerRepository,
    private readonly workspaceService: WorkspaceService,
    private readonly lineClient: LineClient,
    private readonly stateMachine: StateMachine,
    private readonly agentFactory: AgentFactory,
    private readonly lessonsRepo?: LessonsLearnedRepository,
  ) {}

  async startPipeline(projectId: string, _workflowRunId: string): Promise<void> {
    const project = this.projectRepo.findById(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const hearingAnswers = this.hearingAnswerRepo.findByProjectId(projectId);
    if (!hearingAnswers) throw new Error(`No hearing answers for project: ${projectId}`);

    // Pattern 4 – Memory + Dreaming: load recent lessons from past projects
    const lessonsLearned = this.lessonsRepo?.findRecent(10) ?? [];

    // 修正依頼の本文を読み込む（revisionNumber > 0 のとき）
    const revisionContent = project.revisionNumber > 0
      ? this.workspaceService.readFile(
          project.workspacePath,
          `docs/revisions/revision-${project.revisionNumber}.md`,
        ) ?? undefined
      : undefined;

    if (revisionContent) {
      logger.info('Revision content loaded for pipeline', {
        projectId,
        revisionNumber: project.revisionNumber,
        length: revisionContent.length,
      });
    }

    const pipelineStatuses = this.stateMachine.getPipelineStatuses();
    const previousResults: AgentResult[] = [];

    // Pattern 3 – Architect-Implementer Split: explicit context handoff
    let architectureContext: ArchitectureContext | undefined;

    // Pattern 2 – Outcomes Loop: track retry count for implementation phase
    let implRetryCount = 0;

    for (const targetStatus of pipelineStatuses) {
      const current = this.projectRepo.findById(projectId)!;

      if (current.status === 'STOPPED') {
        logger.info('Pipeline halted: project stopped', { projectId });
        return;
      }

      if (targetStatus === 'WAITING_APPROVAL') {
        this.projectRepo.updateStatus(projectId, 'WAITING_APPROVAL');
        this.syncProjectState(projectId);
        await this.lineClient.sendPush(project.userId, this.buildCompletionMessage(projectId));
        return;
      }

      const transition = this.stateMachine.transition(current.status, targetStatus);
      if (!transition.ok) {
        const pipelineOrder = pipelineStatuses.indexOf(current.status as typeof pipelineStatuses[number]);
        const targetOrder = pipelineStatuses.indexOf(targetStatus);
        if (pipelineOrder > targetOrder) continue;
        if (pipelineOrder < targetOrder) throw new Error(`Invalid transition: ${transition.reason}`);
      } else {
        this.projectRepo.updateStatus(projectId, targetStatus);
      }

      const phase = this.stateMachine.phaseFromStatus(targetStatus);
      if (!phase) continue;

      // ── Pattern 1: Sub-Agent Orchestration ──────────────────────────────
      // IMPLEMENTATION and TESTING run in parallel (both depend on design docs but not each other)
      if (targetStatus === 'IMPLEMENTATION') {
        const reviewResult = await this.runImplementationTestingParallelWithRetry(
          projectId, project.userId, project.workspacePath, project.name,
          hearingAnswers, previousResults, architectureContext, lessonsLearned,
          implRetryCount, revisionContent,
        );

        // Extract impl + test results for previousResults continuity
        previousResults.push(...reviewResult.phaseResults);

        // Update retryCount for lesson extraction
        implRetryCount = reviewResult.retryCount;

        // Save Outcomes Loop lesson
        if (this.lessonsRepo && reviewResult.score !== undefined) {
          const lessonType = reviewResult.score >= MIN_SCORE_THRESHOLD ? 'success' : 'retry';
          this.lessonsRepo.save({
            projectId,
            phase: 'implementation+testing',
            lessonType,
            content: reviewResult.score >= MIN_SCORE_THRESHOLD
              ? `実装+テスト並列実行が成功（スコア ${reviewResult.score}）`
              : `実装品質スコアが基準未満（${reviewResult.score}）。${reviewResult.retryCount}回再試行。`,
            score: reviewResult.score,
            retryCount: reviewResult.retryCount,
          });
        }

        this.syncProjectState(projectId);

        // Skip TESTING (handled inside parallel block)
        continue;
      }

      if (targetStatus === 'TESTING' || targetStatus === 'REVIEW') {
        // Both are handled inside runImplementationTestingParallelWithRetry
        continue;
      }

      // ── Standard sequential execution ───────────────────────────────────
      const agent = this.agentFactory.getAgentForPhase(phase);
      const agentRecord = this.agentRepo.findByRole(projectId, agent.role);

      await this.lineClient.sendPush(project.userId, `🔄 ${this.phaseName(targetStatus)} を開始しています...`);

      const task = this.taskRepo.create({
        projectId,
        agentId: agentRecord?.id ?? null,
        type: phase,
        status: 'IN_PROGRESS',
        input: JSON.stringify({ hearingAnswers }),
        output: null,
      });

      try {
        const context: AgentContext = {
          project: this.projectRepo.findById(projectId)!,
          task,
          previousResults: [...previousResults],
          hearingAnswers,
          architectureContext,
          lessonsLearned,
          revisionContent,
        };

        const result = await agent.run(context);
        this.taskRepo.updateOutput(task.id, result.ok ? 'COMPLETED' : 'FAILED', result.summary);

        if (result.files) {
          for (const f of result.files) {
            this.workspaceService.writeFile(project.workspacePath, f.path, f.content);
            this.documentRepo.upsert({ projectId, type: phase, filePath: f.path, content: f.content });
          }
        }

        // Pattern 3 – capture architecture context from BasicDesignAgent
        if (targetStatus === 'BASIC_DESIGN') {
          const captured = extractArchitectureContext(result.data);
          if (captured) {
            architectureContext = captured;
            logger.info('Architecture context captured', { projectId });
          } else {
            // Issue 4 fix: AI なし（モック）時は hearingAnswers から最低限の情報を作成
            architectureContext = {
              decisions: result.files?.find((f) => f.path.includes('basic-design'))?.content ?? '',
              techStack: result.data && typeof (result.data as Record<string, unknown>)['techStack'] === 'string'
                ? (result.data as Record<string, unknown>)['techStack'] as string
                : (hearingAnswers?.techStack ?? '未定'),
            };
            logger.info('Architecture context built from mock result', { projectId });
          }
        }

        this.syncProjectState(projectId);
        previousResults.push(result);

        // Excel generation (fire-and-forget)
        this.generatePhaseExcel(projectId, targetStatus, project.workspacePath, project.name).catch((e) => {
          logger.warn('Excel generation failed', { projectId, phase: targetStatus, err: String(e) });
        });

        await this.lineClient.sendPush(project.userId, `✅ ${this.phaseName(targetStatus)} が完了しました`);
      } catch (err) {
        const errMsg = sanitizeError(err);
        logger.error('Agent phase failed', { projectId, phase, err: errMsg });
        this.taskRepo.updateOutput(task.id, 'FAILED', errMsg);

        // Pattern 4 – save failure lesson
        if (this.lessonsRepo) {
          this.lessonsRepo.save({
            projectId,
            phase,
            lessonType: 'failure',
            content: `${this.phaseName(targetStatus)}フェーズでエラー: ${errMsg.slice(0, 200)}`,
            score: null,
            retryCount: 0,
          });
        }

        throw err;
      }
    }
  }

  /**
   * Pattern 1 – Sub-Agent Orchestration: run IMPLEMENTATION and TESTING in parallel.
   * Pattern 2 – Outcomes Loop: retry implementation if review score is below threshold.
   */
  private async runImplementationTestingParallelWithRetry(
    projectId: string,
    userId: string,
    workspacePath: string,
    projectName: string,
    hearingAnswers: ReturnType<HearingAnswerRepository['findByProjectId']>,
    previousResults: AgentResult[],
    architectureContext: ArchitectureContext | undefined,
    lessonsLearned: ReturnType<LessonsLearnedRepository['findRecent']>,
    initialRetryCount: number,
    revisionContent?: string,
  ): Promise<{ phaseResults: AgentResult[]; score?: number; retryCount: number }> {
    const implAgent = this.agentFactory.getAgentForPhase('implementation');
    const testAgent = this.agentFactory.getAgentForPhase('testing');

    let retryCount = initialRetryCount;
    let lastImplResult: AgentResult | null = null;
    let lastTestResult: AgentResult | null = null;

    await this.lineClient.sendPush(userId,
      `🔄 実装・テストを並列実行しています... （Pattern 1: Sub-Agent Orchestration）`);

    for (let attempt = 0; attempt <= MAX_IMPL_RETRIES; attempt++) {
      retryCount = attempt;

      const project = this.projectRepo.findById(projectId)!;
      if (project.status === 'STOPPED') return { phaseResults: [], retryCount };

      // Transition to IMPLEMENTATION on first attempt
      if (attempt === 0) {
        this.projectRepo.updateStatus(projectId, 'IMPLEMENTATION');
      }

      // ── Pattern 1: Parallel sub-agent execution ──────────────────────
      const implTask = this.taskRepo.create({
        projectId,
        agentId: this.agentRepo.findByRole(projectId, implAgent.role)?.id ?? null,
        type: 'implementation',
        status: 'IN_PROGRESS',
        input: JSON.stringify({ hearingAnswers, attempt }),
        output: null,
      });
      const testTask = this.taskRepo.create({
        projectId,
        agentId: this.agentRepo.findByRole(projectId, testAgent.role)?.id ?? null,
        type: 'testing',
        status: 'IN_PROGRESS',
        input: JSON.stringify({ hearingAnswers }),
        output: null,
      });

      const implContext: AgentContext = {
        project: this.projectRepo.findById(projectId)!,
        task: implTask,
        previousResults: [...previousResults],
        hearingAnswers,
        retryCount: attempt,
        architectureContext,
        lessonsLearned,
        revisionContent,
      };

      const testContext: AgentContext = {
        project: this.projectRepo.findById(projectId)!,
        task: testTask,
        previousResults: [...previousResults],
        hearingAnswers,
        retryCount: attempt,
        architectureContext,       // Issue 3 fix: テストもアーキテクチャ決定を参照する
        lessonsLearned,
        revisionContent,
      };

      // Run both in parallel
      const [implResult, testResult] = await Promise.all([
        implAgent.run(implContext).catch((err): AgentResult => ({
          ok: false,
          summary: '実装エラー',
          error: sanitizeError(err),
        })),
        testAgent.run(testContext).catch((err): AgentResult => ({
          ok: false,
          summary: 'テストエラー',
          error: sanitizeError(err),
        })),
      ]);

      lastImplResult = implResult;
      lastTestResult = testResult;

      // Persist results
      this.taskRepo.updateOutput(implTask.id, implResult.ok ? 'COMPLETED' : 'FAILED', implResult.summary);
      this.taskRepo.updateOutput(testTask.id, testResult.ok ? 'COMPLETED' : 'FAILED', testResult.summary);

      for (const result of [implResult, testResult]) {
        if (result.files) {
          for (const f of result.files) {
            this.workspaceService.writeFile(workspacePath, f.path, f.content);
            this.documentRepo.upsert({
              projectId,
              type: result === implResult ? 'implementation' : 'testing',
              filePath: f.path,
              content: f.content,
            });
          }
        }
      }

      await this.lineClient.sendPush(userId,
        `✅ 実装・テスト並列実行 完了 (試行 ${attempt + 1})`);

      // Excel generation
      this.generatePhaseExcel(projectId, 'TESTING', workspacePath, projectName).catch(() => {});

      // ── Pattern 2: Outcomes Loop — run ReviewAgent inline ──────────────
      this.projectRepo.updateStatus(projectId, 'REVIEW');
      const reviewAgent = this.agentFactory.getAgentForPhase('review');
      const reviewTask = this.taskRepo.create({
        projectId,
        agentId: this.agentRepo.findByRole(projectId, reviewAgent.role)?.id ?? null,
        type: 'review',
        status: 'IN_PROGRESS',
        input: JSON.stringify({ attempt }),
        output: null,
      });

      await this.lineClient.sendPush(userId, `🔍 品質レビュー中... (Pattern 2: Outcomes Loop)`);

      const allResultsSoFar = [...previousResults, implResult, testResult];
      const reviewContext: AgentContext = {
        project: this.projectRepo.findById(projectId)!,
        task: reviewTask,
        previousResults: allResultsSoFar,
        hearingAnswers,
        retryCount: attempt,
        lessonsLearned,
        revisionContent,
      };

      const reviewResult = await reviewAgent.run(reviewContext).catch((err): AgentResult => ({
        ok: false,
        summary: 'レビューエラー',
        error: sanitizeError(err),
        score: undefined,
      }));

      this.taskRepo.updateOutput(reviewTask.id, reviewResult.ok ? 'COMPLETED' : 'FAILED', reviewResult.summary);

      if (reviewResult.files) {
        for (const f of reviewResult.files) {
          this.workspaceService.writeFile(workspacePath, f.path, f.content);
          this.documentRepo.upsert({ projectId, type: 'review', filePath: f.path, content: f.content });
        }
      }

      const score = reviewResult.score;
      const scoreMsg = score !== undefined ? ` (スコア: ${score}/100)` : ' (スコア取得失敗)';

      const scoreOk = score !== undefined && score >= MIN_SCORE_THRESHOLD;
      const maxRetriesReached = attempt >= MAX_IMPL_RETRIES;

      if (scoreOk || maxRetriesReached) {
        if (!scoreOk) {
          // max retries に達したが品質基準未達 or スコア取得失敗
          await this.lineClient.sendPush(userId,
            `⚠️ 品質スコア${scoreMsg} — 最大再試行に達しました。人間によるレビューを推奨します。`);
        } else {
          await this.lineClient.sendPush(userId,
            `✅ コードレビュー完了${scoreMsg}`);
        }

        return {
          phaseResults: [implResult, testResult, reviewResult],
          score,
          retryCount: attempt,
        };
      }

      // スコア基準未達 かつ リトライ残あり（score undefined も含む）
      await this.lineClient.sendPush(userId,
        `🔄 品質スコア${scoreMsg} — 基準 (${MIN_SCORE_THRESHOLD}) 未満。実装を改善して再試行します... (${attempt + 1}/${MAX_IMPL_RETRIES})`);

      // Reset IMPLEMENTATION status for retry
      this.projectRepo.updateStatus(projectId, 'IMPLEMENTATION');
    }

    // Fallback (should not reach here)
    return {
      phaseResults: [lastImplResult!, lastTestResult!].filter(Boolean),
      retryCount,
    };
  }

  private async generatePhaseExcel(
    projectId: string,
    status: string,
    workspacePath: string,
    projectName: string,
  ): Promise<void> {
    const answers = this.hearingAnswerRepo.findByProjectId(projectId);
    if (!answers) return;

    switch (status) {
      case 'REQUIREMENTS':
        await generateRequirementsExcel(workspacePath, projectName, answers);
        break;
      case 'BASIC_DESIGN':
        await generateBasicDesignExcel(workspacePath, projectName, answers);
        if (answers.screens && answers.screens.trim()) {
          await generateScreenDesignExcel(workspacePath, projectName, answers);
        }
        break;
      case 'DETAILED_DESIGN':
        await generateDetailedDesignExcel(workspacePath, projectName, answers, true);
        break;
      case 'TESTING':
        await generateTestSpecExcel(workspacePath, projectName);
        await generateManualTestSpecExcel(workspacePath, projectName);
        break;
      case 'WAITING_APPROVAL':
        await generateIssueListExcel(workspacePath, projectName);
        break;
    }
  }

  private buildCompletionMessage(projectId: string): string {
    const project = this.projectRepo.findById(projectId);
    const files = project ? this.workspaceService.listFiles(project.workspacePath) : [];

    return [
      `✨ 全フェーズが完了しました！`,
      ``,
      `プロジェクト名: ${project?.name ?? projectId}`,
      `状態: 承認待ち`,
      ``,
      `生成されたファイル:`,
      ...files.slice(0, 10).map((f) => `  - ${f}`),
      files.length > 10 ? `  ... 他${files.length - 10}件` : '',
      ``,
      `次にできる操作:`,
      `・承認 → 完了にする`,
      `・修正: <内容> → 修正を依頼する`,
      `・進捗 → 詳細を確認する`,
    ].filter((l) => l !== '').join('\n');
  }

  private syncProjectState(projectId: string): void {
    const project = this.projectRepo.findById(projectId);
    if (!project) return;
    const hearingAnswers = this.hearingAnswerRepo.findByProjectId(projectId);
    const files = this.workspaceService.listFiles(project.workspacePath);

    this.workspaceService.updateProjectState(project.workspacePath, {
      projectId,
      name: project.name,
      status: project.status,
      revisionNumber: project.revisionNumber,
      hearingAnswers: hearingAnswers ? Object.fromEntries(
        Object.entries(hearingAnswers).filter(([k]) => !['id', 'projectId', 'updatedAt'].includes(k))
      ) : {},
      generatedFiles: files,
      updatedAt: new Date().toISOString(),
    });
  }

  private phaseName(status: string): string {
    const names: Record<string, string> = {
      REQUIREMENTS:    '要件定義',
      BASIC_DESIGN:    '基本設計',
      DETAILED_DESIGN: '詳細設計',
      IMPLEMENTATION:  '実装',
      TESTING:         'テスト',
      REVIEW:          'レビュー',
    };
    return names[status] ?? status;
  }

  syncProjectStatePublic(projectId: string): void {
    this.syncProjectState(projectId);
  }
}
