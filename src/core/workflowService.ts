import { ProjectRepository } from '../db/repositories/projectRepository';
import { TaskRepository } from '../db/repositories/taskRepository';
import { AgentRepository } from '../db/repositories/agentRepository';
import { DocumentRepository } from '../db/repositories/documentRepository';
import { HearingAnswerRepository } from '../db/repositories/hearingAnswerRepository';
import { WorkspaceService } from './workspaceService';
import { LineClient } from '../line/lineClient';
import { StateMachine } from './stateMachine';
import { AgentFactory } from '../agents/AgentFactory';
import { AgentContext, AgentResult } from '../agents/Agent';
import { logger } from '../utils/logger';

export function sanitizeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.slice(0, 500);
}

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
  ) {}

  async startPipeline(projectId: string, _workflowRunId: string): Promise<void> {
    const project = this.projectRepo.findById(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const hearingAnswers = this.hearingAnswerRepo.findByProjectId(projectId);
    if (!hearingAnswers) throw new Error(`No hearing answers for project: ${projectId}`);

    const pipelineStatuses = this.stateMachine.getPipelineStatuses();
    const previousResults: AgentResult[] = [];

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
        if (pipelineOrder > targetOrder) continue; // already past → skip phase
        if (pipelineOrder < targetOrder) throw new Error(`Invalid transition: ${transition.reason}`);
        // pipelineOrder === targetOrder: already at this status — run agent without updating status
      } else {
        this.projectRepo.updateStatus(projectId, targetStatus);
      }

      const phase = this.stateMachine.phaseFromStatus(targetStatus);
      if (!phase) continue;

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
        };

        const result = await agent.run(context);
        this.taskRepo.updateOutput(task.id, result.ok ? 'COMPLETED' : 'FAILED', result.summary);

        if (result.files) {
          for (const f of result.files) {
            this.workspaceService.writeFile(project.workspacePath, f.path, f.content);
            this.documentRepo.upsert({
              projectId,
              type: phase,
              filePath: f.path,
              content: f.content,
            });
          }
        }

        this.syncProjectState(projectId);
        previousResults.push(result);

        await this.lineClient.sendPush(project.userId, `✅ ${this.phaseName(targetStatus)} が完了しました`);
      } catch (err) {
        const errMsg = sanitizeError(err);
        logger.error('Agent phase failed', { projectId, phase, err: errMsg });
        this.taskRepo.updateOutput(task.id, 'FAILED', errMsg);
        throw err;
      }
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
