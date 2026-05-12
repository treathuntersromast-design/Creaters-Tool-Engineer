import { ProjectRepository } from '../db/repositories/projectRepository';
import { WorkflowRunRepository } from '../db/repositories/workflowRunRepository';
import { LineClient } from '../line/lineClient';
import { WorkflowService, sanitizeError } from './workflowService';
import { logger } from '../utils/logger';

export class WorkflowRunner {
  private readonly memoryLock = new Set<string>();

  constructor(
    private readonly workflowService: WorkflowService,
    private readonly workflowRunRepo: WorkflowRunRepository,
    private readonly projectRepo: ProjectRepository,
    private readonly lineClient: LineClient,
  ) {}

  run(projectId: string): void {
    if (this.memoryLock.has(projectId)) {
      logger.debug('WorkflowRunner: memory lock active, skipping', { projectId });
      return;
    }

    if (this.workflowRunRepo.hasRunning(projectId)) {
      logger.debug('WorkflowRunner: DB RUNNING run exists, skipping', { projectId });
      return;
    }

    this.memoryLock.add(projectId);
    const run = this.workflowRunRepo.create(projectId);
    logger.info('WorkflowRunner: pipeline started', { projectId, runId: run.id });

    void this.workflowService.startPipeline(projectId, run.id)
      .then(() => {
        this.workflowRunRepo.finish(run.id, 'SUCCEEDED');
        logger.info('WorkflowRunner: pipeline succeeded', { projectId, runId: run.id });
      })
      .catch(async (err: unknown) => {
        const errMsg = sanitizeError(err);
        logger.error('WorkflowRunner: pipeline failed', { projectId, runId: run.id, err: errMsg });
        this.workflowRunRepo.finish(run.id, 'FAILED', errMsg);
        this.projectRepo.setFailed(projectId, errMsg);

        const project = this.projectRepo.findById(projectId);
        if (project) {
          await this.lineClient.sendPush(
            project.userId,
            '❌ 開発処理でエラーが発生しました。「進捗」コマンドで状態を確認してください。'
          ).catch((lineErr: unknown) => {
            logger.error('Failed to send error notification to LINE', { err: String(lineErr) });
          });
        }
      })
      .finally(() => {
        this.memoryLock.delete(projectId);
      });
  }

  isRunning(projectId: string): boolean {
    return this.memoryLock.has(projectId) || this.workflowRunRepo.hasRunning(projectId);
  }
}
