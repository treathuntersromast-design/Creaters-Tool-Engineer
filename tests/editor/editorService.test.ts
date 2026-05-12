import { EditorService } from '../../src/editor/editorService';

// Mock child_process to avoid real process spawning in tests
jest.mock('child_process', () => ({
  execFile: jest.fn(),
  spawn: jest.fn(() => ({ unref: jest.fn() })),
}));

// Mock fs to control path existence checks
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(() => false),
}));

import { execFile, spawn } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';

const mockExecFile = execFile as unknown as jest.Mock;
const mockSpawn = spawn as unknown as jest.Mock;
const mockExistsSync = fs.existsSync as jest.Mock;

function buildService() {
  const pushMessages: Array<{ userId: string; text: string }> = [];
  const lineClient = {
    sendPush: jest.fn(async (userId: string, text: string) => {
      pushMessages.push({ userId, text });
    }),
  };
  const service = new EditorService(lineClient as any);
  return { service, lineClient, pushMessages };
}

// Helper: make execFile resolve with given stdout
function mockExecResolve(stdout: string) {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, callback: Function) => {
      callback(null, { stdout, stderr: '' });
    },
  );
}

// Helper: make execFile reject (command not found)
function mockExecReject(err: Error = new Error('not found')) {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, callback: Function) => {
      callback(err, { stdout: '', stderr: '' });
    },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
});

describe('EditorService', () => {
  // ── handleLaunch ──────────────────────────────────────────────────────────

  describe('handleLaunch', () => {
    it('sends error when no editor is installed or in PATH', async () => {
      const { service, pushMessages } = buildService();
      mockExecReject();
      mockExistsSync.mockReturnValue(false);

      await service.handleLaunch('U1', undefined, undefined);

      expect(pushMessages[0]?.text).toContain('見つかりませんでした');
    });

    it('sends info when editor is already running and no targetPath given', async () => {
      const { service, pushMessages } = buildService();

      // `where code` succeeds → code is in PATH
      // `tasklist` returns the process name → running
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, callback: Function) => {
          if (_cmd === 'where') {
            callback(null, { stdout: 'C:\\code.cmd\n', stderr: '' });
          } else if (_cmd === 'tasklist') {
            callback(null, { stdout: '"Code.exe","1234","Console","1","50,000 K"', stderr: '' });
          } else {
            callback(new Error('unexpected'), { stdout: '', stderr: '' });
          }
        },
      );

      await service.handleLaunch('U1', undefined, 'VSCode');

      expect(pushMessages[0]?.text).toContain('すでに起動しています');
      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('launches editor when not running', async () => {
      const { service, pushMessages } = buildService();

      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, callback: Function) => {
          if (_cmd === 'where') {
            callback(null, { stdout: 'C:\\code.cmd\n', stderr: '' });
          } else if (_cmd === 'tasklist') {
            // Not in output → not running
            callback(null, { stdout: 'INFO: No tasks are running.', stderr: '' });
          } else {
            callback(new Error('unexpected'), { stdout: '', stderr: '' });
          }
        },
      );

      await service.handleLaunch('U1', undefined, 'VSCode');

      expect(mockSpawn).toHaveBeenCalled();
      expect(pushMessages[0]?.text).toContain('起動しました');
    });

    it('launches editor with targetPath when already running', async () => {
      const { service, pushMessages } = buildService();

      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, callback: Function) => {
          if (_cmd === 'where') {
            callback(null, { stdout: 'C:\\code.cmd\n', stderr: '' });
          } else if (_cmd === 'tasklist') {
            // Running
            callback(null, { stdout: '"Code.exe","1","Console","1","10 K"', stderr: '' });
          } else {
            callback(new Error('unexpected'), { stdout: '', stderr: '' });
          }
        },
      );

      const targetPath = 'C:\\repos\\my-app';
      await service.handleLaunch('U1', targetPath, 'VSCode');

      // When targetPath is given, even if running, it should open the folder
      expect(mockSpawn).toHaveBeenCalled();
      const spawnArgs = mockSpawn.mock.calls[0];
      expect(spawnArgs[1]).toContain(targetPath);
      expect(pushMessages[0]?.text).toContain('起動しました');
      expect(pushMessages[0]?.text).toContain('my-app');
    });

    it('falls back to filesystem paths when not in PATH', async () => {
      const { service, pushMessages } = buildService();

      // `where` always fails
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, callback: Function) => {
          if (_cmd === 'where') {
            callback(new Error('not found'), { stdout: '', stderr: '' });
          } else if (_cmd === 'tasklist') {
            callback(null, { stdout: 'INFO: No tasks.', stderr: '' });
          } else {
            callback(new Error('unexpected'), { stdout: '', stderr: '' });
          }
        },
      );

      // But the filesystem path exists
      mockExistsSync.mockImplementation((p: string) =>
        String(p).toLowerCase().includes('cursor'),
      );

      await service.handleLaunch('U1', undefined, 'Cursor');

      expect(mockSpawn).toHaveBeenCalled();
      expect(pushMessages[0]?.text).toContain('起動しました');
    });

    it('sends error message when spawn throws', async () => {
      const { service, pushMessages } = buildService();

      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: unknown, callback: Function) => {
          if (_cmd === 'where') {
            callback(null, { stdout: 'C:\\code.cmd\n', stderr: '' });
          } else if (_cmd === 'tasklist') {
            callback(null, { stdout: 'INFO: No tasks.', stderr: '' });
          } else {
            callback(new Error('nope'), { stdout: '', stderr: '' });
          }
        },
      );

      mockSpawn.mockImplementation(() => {
        throw new Error('spawn failed');
      });

      await service.handleLaunch('U1', undefined, 'VSCode');

      expect(pushMessages[0]?.text).toContain('起動に失敗しました');
    });

    it('uses editorHint to prefer Cursor over VSCode', async () => {
      const { service } = buildService();

      const called: string[] = [];
      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, callback: Function) => {
          if (_cmd === 'where') {
            called.push(args[0] as string);
            if ((args[0] as string) === 'cursor') {
              callback(null, { stdout: 'C:\\cursor.cmd\n', stderr: '' });
            } else {
              callback(new Error('not found'), { stdout: '', stderr: '' });
            }
          } else if (_cmd === 'tasklist') {
            callback(null, { stdout: 'INFO: No tasks.', stderr: '' });
          } else {
            callback(new Error('nope'), { stdout: '', stderr: '' });
          }
        },
      );

      await service.handleLaunch('U1', undefined, 'Cursor');

      expect(mockSpawn).toHaveBeenCalled();
      const spawnCmd = mockSpawn.mock.calls[0][0];
      expect(spawnCmd).toBe('cursor');
    });
  });

  // ── handleStatus ─────────────────────────────────────────────────────────

  describe('handleStatus', () => {
    it('sends error when no editors are installed', async () => {
      const { service, pushMessages } = buildService();
      mockExecReject();
      mockExistsSync.mockReturnValue(false);

      await service.handleStatus('U1');

      expect(pushMessages[0]?.text).toContain('見つかりませんでした');
    });

    it('shows installed editors with running status', async () => {
      const { service, pushMessages } = buildService();

      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, callback: Function) => {
          if (_cmd === 'where') {
            if ((args[0] as string) === 'code') {
              callback(null, { stdout: 'C:\\code.cmd\n', stderr: '' });
            } else {
              callback(new Error('nf'), { stdout: '', stderr: '' });
            }
          } else if (_cmd === 'tasklist') {
            // VSCode running, others not
            const name = args[1] as string; // `/FI IMAGENAME eq Name.exe`
            const processName = (name as string).split(' eq ')[1] ?? '';
            if (processName.toLowerCase().includes('code.exe')) {
              callback(null, { stdout: `"Code.exe","1","Console","1","10 K"`, stderr: '' });
            } else {
              callback(null, { stdout: 'INFO: No tasks.', stderr: '' });
            }
          } else {
            callback(new Error('nope'), { stdout: '', stderr: '' });
          }
        },
      );

      await service.handleStatus('U1');

      const text = pushMessages[0]?.text ?? '';
      expect(text).toContain('エディター状況');
      expect(text).toContain('VSCode');
    });

    it('includes usage hint in status message', async () => {
      const { service, pushMessages } = buildService();

      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, callback: Function) => {
          if (_cmd === 'where' && (args[0] as string) === 'code') {
            callback(null, { stdout: 'C:\\code.cmd\n', stderr: '' });
          } else if (_cmd === 'where') {
            callback(new Error('nf'), { stdout: '', stderr: '' });
          } else if (_cmd === 'tasklist') {
            callback(null, { stdout: 'INFO: No tasks.', stderr: '' });
          } else {
            callback(new Error('nope'), { stdout: '', stderr: '' });
          }
        },
      );

      await service.handleStatus('U1');

      const text = pushMessages[0]?.text ?? '';
      expect(text).toContain('VSCodeを開いて');
    });
  });

  // ── getAllStatuses ────────────────────────────────────────────────────────

  describe('getAllStatuses', () => {
    it('returns installed=false when neither in PATH nor in known paths', async () => {
      const { service } = buildService();
      mockExecReject();
      mockExistsSync.mockReturnValue(false);

      const statuses = await service.getAllStatuses();

      expect(statuses.every((s) => !s.installed)).toBe(true);
    });

    it('returns installed=true when editor is in PATH', async () => {
      const { service } = buildService();

      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, callback: Function) => {
          if (_cmd === 'where' && (args[0] as string) === 'code') {
            callback(null, { stdout: 'C:\\code.cmd\n', stderr: '' });
          } else if (_cmd === 'where') {
            callback(new Error('nf'), { stdout: '', stderr: '' });
          } else if (_cmd === 'tasklist') {
            callback(null, { stdout: 'INFO: No tasks.', stderr: '' });
          } else {
            callback(new Error('nope'), { stdout: '', stderr: '' });
          }
        },
      );

      const statuses = await service.getAllStatuses();
      const vscode = statuses.find((s) => s.shortName === 'VSCode');
      expect(vscode?.installed).toBe(true);
    });

    it('returns running=true when process is found in tasklist', async () => {
      const { service } = buildService();

      mockExecFile.mockImplementation(
        (_cmd: string, args: string[], _opts: unknown, callback: Function) => {
          if (_cmd === 'where' && (args[0] as string) === 'code') {
            callback(null, { stdout: 'C:\\code.cmd\n', stderr: '' });
          } else if (_cmd === 'where') {
            callback(new Error('nf'), { stdout: '', stderr: '' });
          } else if (_cmd === 'tasklist') {
            const filterArg = (args[1] as string) ?? '';
            if (filterArg.toLowerCase().includes('code.exe')) {
              callback(null, { stdout: '"Code.exe","999","Console","1","50 K"', stderr: '' });
            } else {
              callback(null, { stdout: 'INFO: No tasks.', stderr: '' });
            }
          } else {
            callback(new Error('nope'), { stdout: '', stderr: '' });
          }
        },
      );

      const statuses = await service.getAllStatuses();
      const vscode = statuses.find((s) => s.shortName === 'VSCode');
      expect(vscode?.running).toBe(true);
    });
  });

  describe('launchProcess targetPath validation (G-04)', () => {
    it('throws when targetPath is a relative path', () => {
      const { service } = buildService();
      expect(() =>
        (service as unknown as { launchProcess(cmd: string, p: string): void })
          .launchProcess('code', 'relative/path'),
      ).toThrow('absolute');
    });

    it('throws when targetPath uses ../ traversal', () => {
      const { service } = buildService();
      expect(() =>
        (service as unknown as { launchProcess(cmd: string, p: string): void })
          .launchProcess('code', '../etc/passwd'),
      ).toThrow('absolute');
    });

    it('does not throw when targetPath is absolute', () => {
      const { service } = buildService();
      mockSpawn.mockReturnValue({ unref: jest.fn() });
      expect(() =>
        (service as unknown as { launchProcess(cmd: string, p: string): void })
          .launchProcess('code', 'C:\\Users\\test\\project'),
      ).not.toThrow();
    });

    it('does not throw when targetPath is undefined', () => {
      const { service } = buildService();
      mockSpawn.mockReturnValue({ unref: jest.fn() });
      expect(() =>
        (service as unknown as { launchProcess(cmd: string, p?: string): void })
          .launchProcess('code'),
      ).not.toThrow();
    });
  });
});
