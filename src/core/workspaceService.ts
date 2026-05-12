import fs from 'fs';
import path from 'path';
import { loadConfig } from '../config/env';
import { safeWorkspacePath } from '../utils/safePath';
import { logger } from '../utils/logger';

export interface ProjectState {
  projectId: string;
  name: string;
  status: string;
  revisionNumber: number;
  hearingAnswers: Record<string, unknown>;
  generatedFiles: string[];
  updatedAt: string;
}

export class WorkspaceService {
  private readonly workspaceRoot: string;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = path.resolve(workspaceRoot ?? loadConfig().workspace.root);
  }

  createProjectWorkspace(slug: string): string {
    const projectDir = path.join(this.workspaceRoot, slug);
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'docs', 'revisions'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'tests'), { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'logs'), { recursive: true });
    logger.info('Workspace created', { path: projectDir });
    return projectDir;
  }

  writeFile(workspacePath: string, relativePath: string, content: string): void {
    const absPath = safeWorkspacePath(workspacePath, relativePath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf-8');
    logger.debug('File written', { path: absPath });
  }

  readFile(workspacePath: string, relativePath: string): string | null {
    try {
      const absPath = safeWorkspacePath(workspacePath, relativePath);
      return fs.readFileSync(absPath, 'utf-8');
    } catch {
      return null;
    }
  }

  listFiles(workspacePath: string): string[] {
    const files: string[] = [];
    const collect = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          collect(full);
        } else {
          files.push(path.relative(workspacePath, full));
        }
      }
    };
    collect(workspacePath);
    return files;
  }

  updateProjectState(workspacePath: string, state: ProjectState): void {
    try {
      this.writeFile(workspacePath, 'project-state.json', JSON.stringify(state, null, 2));
    } catch (err) {
      logger.error('Failed to update project-state.json', { err: String(err) });
    }
  }

  writeTeamJson(workspacePath: string, agents: Array<{ name: string; role: string }>): void {
    const team = {
      agents,
      createdAt: new Date().toISOString(),
    };
    this.writeFile(workspacePath, 'team.json', JSON.stringify(team, null, 2));
  }
}
