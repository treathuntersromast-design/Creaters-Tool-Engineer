import fs from 'fs';
import path from 'path';
import os from 'os';
import { WorkspaceService } from '../src/core/workspaceService';
import { createProjectSlug } from '../src/utils/slugify';

describe('WorkspaceService', () => {
  let tempRoot: string;
  let service: WorkspaceService;

  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'test-workspace-'));
    service = new WorkspaceService(tempRoot);
  });

  afterEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  });

  describe('createProjectWorkspace', () => {
    test('creates project directory structure', () => {
      const slug = 'test-project-20240101-abc123';
      service.createProjectWorkspace(slug);

      const projectDir = path.join(tempRoot, slug);
      expect(fs.existsSync(projectDir)).toBe(true);
      expect(fs.existsSync(path.join(projectDir, 'docs'))).toBe(true);
      expect(fs.existsSync(path.join(projectDir, 'src'))).toBe(true);
      expect(fs.existsSync(path.join(projectDir, 'tests'))).toBe(true);
      expect(fs.existsSync(path.join(projectDir, 'logs'))).toBe(true);
    });

    test('returns absolute path', () => {
      const slug = 'test-project-20240101-abc123';
      const result = service.createProjectWorkspace(slug);
      expect(path.isAbsolute(result)).toBe(true);
    });
  });

  describe('writeFile', () => {
    test('writes file to workspace', () => {
      const slug = 'test-project-20240101-abc123';
      const workspacePath = service.createProjectWorkspace(slug);
      service.writeFile(workspacePath, 'docs/test.md', '# Test');

      const filePath = path.join(workspacePath, 'docs', 'test.md');
      expect(fs.existsSync(filePath)).toBe(true);
      expect(fs.readFileSync(filePath, 'utf-8')).toBe('# Test');
    });

    test('rejects path traversal outside workspace', () => {
      const slug = 'test-project-20240101-abc123';
      const workspacePath = service.createProjectWorkspace(slug);
      expect(() => service.writeFile(workspacePath, '../outside.txt', 'evil')).toThrow();
    });

    test('rejects absolute path', () => {
      const slug = 'test-project-20240101-abc123';
      const workspacePath = service.createProjectWorkspace(slug);
      expect(() => service.writeFile(workspacePath, '/etc/passwd', 'evil')).toThrow();
    });
  });

  describe('listFiles', () => {
    test('lists files in workspace', () => {
      const slug = 'test-project-20240101-abc123';
      const workspacePath = service.createProjectWorkspace(slug);
      service.writeFile(workspacePath, 'docs/requirements.md', '# Req');
      service.writeFile(workspacePath, 'src/index.ts', 'export {}');

      const files = service.listFiles(workspacePath);
      const normalized = files.map((f) => f.replace(/\\/g, '/'));
      expect(normalized).toContain('docs/requirements.md');
      expect(normalized).toContain('src/index.ts');
    });
  });

  describe('updateProjectState', () => {
    test('creates project-state.json', () => {
      const slug = 'test-project-20240101-abc123';
      const workspacePath = service.createProjectWorkspace(slug);
      service.updateProjectState(workspacePath, {
        projectId: 'pid',
        name: 'Test',
        status: 'HEARING',
        revisionNumber: 0,
        hearingAnswers: {},
        generatedFiles: [],
        updatedAt: new Date().toISOString(),
      });

      const statePath = path.join(workspacePath, 'project-state.json');
      expect(fs.existsSync(statePath)).toBe(true);
      const state = JSON.parse(fs.readFileSync(statePath, 'utf-8'));
      expect(state.status).toBe('HEARING');
    });
  });
});

describe('createProjectSlug', () => {
  test('generates unique slugs for same name', () => {
    const slug1 = createProjectSlug('My App');
    const slug2 = createProjectSlug('My App');
    expect(slug1).not.toBe(slug2);
  });

  test('handles Japanese name', () => {
    const slug = createProjectSlug('テストアプリ');
    expect(slug).toBeTruthy();
    expect(slug.length).toBeGreaterThan(0);
    // Should not throw or produce empty base
    expect(slug).toMatch(/^project-/);
  });

  test('handles English name', () => {
    const slug = createProjectSlug('my-awesome-app');
    expect(slug).toMatch(/^my-awesome-app-/);
  });

  test('avoids Windows reserved names', () => {
    const slug = createProjectSlug('CON');
    expect(slug).toMatch(/^proj-con-/);
  });

  test('produces unique suffix', () => {
    const slug = createProjectSlug('test');
    expect(slug).toMatch(/^test-\d{14}-[a-f0-9]{6}$/);
  });
});
