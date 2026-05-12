import path from 'path';
import { safeWorkspacePath } from '../src/utils/safePath';

const ROOT = path.resolve('/workspace/root');

describe('safeWorkspacePath', () => {
  describe('valid paths', () => {
    test('allows simple file path', () => {
      const result = safeWorkspacePath(ROOT, 'docs/requirements.md');
      expect(result).toBe(path.join(ROOT, 'docs/requirements.md'));
    });

    test('allows nested path', () => {
      const result = safeWorkspacePath(ROOT, 'src/utils/helper.ts');
      expect(result).toContain('src');
    });

    test('normalizes double slashes', () => {
      const result = safeWorkspacePath(ROOT, 'docs//requirements.md');
      expect(result).not.toContain('//');
    });
  });

  describe('path traversal rejection', () => {
    test('rejects .. traversal', () => {
      expect(() => safeWorkspacePath(ROOT, '../outside.txt')).toThrow('Path traversal');
    });

    test('rejects deep .. traversal', () => {
      expect(() => safeWorkspacePath(ROOT, '../../etc/passwd')).toThrow('Path traversal');
    });

    test('rejects traversal inside path', () => {
      expect(() => safeWorkspacePath(ROOT, 'docs/../../etc/passwd')).toThrow('Path traversal');
    });

    test('rejects absolute path', () => {
      expect(() => safeWorkspacePath(ROOT, '/etc/passwd')).toThrow('Absolute path');
    });

    test('rejects Windows-style absolute path', () => {
      expect(() => safeWorkspacePath(ROOT, 'C:\\Windows\\System32')).toThrow();
    });
  });

  describe('does not throw on root-level file', () => {
    test('allows file at root level', () => {
      expect(() => safeWorkspacePath(ROOT, 'team.json')).not.toThrow();
    });
  });
});
