export interface CodeTask {
  description: string;
  fileName: string;
  projectName: string;
}

export interface CodeExecutionResult {
  success: boolean;
  files: Array<{ path: string; content: string }>;
  logs: string[];
  error?: string;
}

export interface CodeExecutor {
  execute(task: CodeTask): Promise<CodeExecutionResult>;
}
