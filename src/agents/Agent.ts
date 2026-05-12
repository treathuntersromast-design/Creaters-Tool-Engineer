import { Project } from '../db/repositories/projectRepository';
import { Task } from '../db/repositories/taskRepository';
import { HearingAnswer } from '../db/repositories/hearingAnswerRepository';

export interface AgentResult {
  ok: boolean;
  summary: string;
  files?: Array<{ path: string; content: string }>;
  data?: unknown;
  error?: string;
}

export interface AgentContext {
  project: Project;
  task: Task;
  previousResults?: AgentResult[];
  hearingAnswers?: HearingAnswer;
}

export interface Agent {
  name: string;
  role: string;
  run(context: AgentContext): Promise<AgentResult>;
}
