import { Project } from '../db/repositories/projectRepository';
import { Task } from '../db/repositories/taskRepository';
import { HearingAnswer } from '../db/repositories/hearingAnswerRepository';
import { LessonLearned } from '../db/repositories/lessonsLearnedRepository';

export interface AgentResult {
  ok: boolean;
  summary: string;
  files?: Array<{ path: string; content: string }>;
  data?: unknown;
  error?: string;
  /** Pattern 2 – Outcomes Loop: quality score 0-100 returned by ReviewAgent */
  score?: number;
}

/** Pattern 3 – Architect-Implementer Split: design decisions passed to ImplementationAgent */
export interface ArchitectureContext {
  decisions: string;
  techStack: string;
  componentMap?: Record<string, string>;
}

export interface AgentContext {
  project: Project;
  task: Task;
  previousResults?: AgentResult[];
  hearingAnswers?: HearingAnswer;
  /** Pattern 2 – Outcomes Loop: how many times this phase has been retried */
  retryCount?: number;
  /** Pattern 3 – Architect-Implementer Split: explicit handoff from DesignAgent */
  architectureContext?: ArchitectureContext;
  /** Pattern 4 – Memory + Dreaming: lessons injected from past projects */
  lessonsLearned?: LessonLearned[];
  /**
   * 修正依頼の本文（revisionNumber > 0 のときのみセット）。
   * docs/revisions/revision-N.md の内容をそのまま渡す。
   * 全エージェントはこれを参照して「何を変えるか」を把握する。
   */
  revisionContent?: string;
}

export interface Agent {
  name: string;
  role: string;
  run(context: AgentContext): Promise<AgentResult>;
}
