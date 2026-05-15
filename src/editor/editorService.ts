import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { LineClient } from '../line/lineClient';
import { logger } from '../utils/logger';

const execAsync = promisify(execFile);

export interface EditorDef {
  name: string;
  shortName: string;   // used in LINE messages
  processName: string; // Windows process name (for running check)
  commands: string[];  // CLI commands to try
  paths: string[];     // fallback install paths
}

const EDITORS: EditorDef[] = [
  {
    name: 'Visual Studio Code',
    shortName: 'VSCode',
    processName: 'Code.exe',
    commands: ['code'],
    paths: [
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code', 'Code.exe'),
      'C:\\Program Files\\Microsoft VS Code\\Code.exe',
      'C:\\Program Files (x86)\\Microsoft VS Code\\Code.exe',
    ],
  },
  {
    name: 'Cursor',
    shortName: 'Cursor',
    processName: 'Cursor.exe',
    commands: ['cursor'],
    paths: [
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'cursor', 'Cursor.exe'),
      path.join(os.homedir(), 'AppData', 'Local', 'cursor', 'Cursor.exe'),
    ],
  },
  {
    name: 'VS Code Insiders',
    shortName: 'Insiders',
    processName: 'Code - Insiders.exe',
    commands: ['code-insiders'],
    paths: [
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
    ],
  },
];

interface ResolvedEditor {
  def: EditorDef;
  command: string;
}

export interface EditorStatus {
  name: string;
  shortName: string;
  installed: boolean;
  running: boolean;
}

export class EditorService {
  constructor(private readonly lineClient: LineClient) {}

  // ── detection ────────────────────────────────────────────────────────────

  private async isProcessRunning(processName: string): Promise<boolean> {
    try {
      const { stdout } = await execAsync(
        'tasklist',
        ['/FI', `IMAGENAME eq ${processName}`, '/NH', '/FO', 'CSV'],
        { timeout: 5_000, encoding: 'utf-8' },
      );
      return stdout.toLowerCase().includes(processName.toLowerCase());
    } catch {
      return false;
    }
  }

  private async resolveEditor(def: EditorDef): Promise<string | null> {
    // 1. Try each CLI command via `where`
    for (const cmd of def.commands) {
      try {
        const { stdout } = await execAsync('where', [cmd], {
          timeout: 3_000, encoding: 'utf-8',
        });
        if (stdout.trim()) return cmd;
      } catch { /* not in PATH */ }
    }

    // 2. Try known install paths
    for (const p of def.paths) {
      if (fs.existsSync(p)) return p;
    }

    return null;
  }

  private async findEditor(hint?: string): Promise<ResolvedEditor | null> {
    // If a hint is given, filter by shortName / name match first
    const candidates = hint
      ? EDITORS.filter((e) =>
          e.shortName.toLowerCase().includes(hint.toLowerCase()) ||
          e.name.toLowerCase().includes(hint.toLowerCase()),
        )
      : EDITORS;

    const ordered = hint ? [...candidates, ...EDITORS.filter((e) => !candidates.includes(e))] : EDITORS;

    for (const def of ordered) {
      const command = await this.resolveEditor(def);
      if (command) return { def, command };
    }
    return null;
  }

  async getAllStatuses(): Promise<EditorStatus[]> {
    return Promise.all(
      EDITORS.map(async (def) => {
        const [command, running] = await Promise.all([
          this.resolveEditor(def),
          this.isProcessRunning(def.processName),
        ]);
        return {
          name: def.name,
          shortName: def.shortName,
          installed: command !== null,
          running,
        };
      }),
    );
  }

  // ── launch ────────────────────────────────────────────────────────────────

  private launchProcess(command: string, targetPath?: string): void {
    if (targetPath !== undefined && !path.isAbsolute(targetPath)) {
      throw new Error(`Editor targetPath must be absolute: ${targetPath}`);
    }
    const args = targetPath ? [targetPath] : [];
    const proc = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,  // editor window should appear on screen
    });
    proc.on('error', (err) => {
      logger.warn('Editor launch failed', { command, err: err.message });
    });
    proc.unref(); // let it live beyond the parent process
  }

  // ── LINE handlers ─────────────────────────────────────────────────────────

  /** Launch editor, optionally opening a specific folder (validated path only) */
  async handleLaunch(userId: string, targetPath?: string, editorHint?: string): Promise<void> {
    const editor = await this.findEditor(editorHint);

    if (!editor) {
      const tried = editorHint ?? 'VSCode / Cursor';
      await this.lineClient.sendPush(
        userId,
        `❌ ${tried} が見つかりませんでした。\n` +
        `インストールされていないか、PATHに登録されていない可能性があります。\n\n` +
        `「エディター確認」で対応エディター一覧を確認できます。`,
      );
      return;
    }

    const isRunning = await this.isProcessRunning(editor.def.processName);

    if (isRunning && !targetPath) {
      await this.lineClient.sendPush(
        userId,
        `ℹ️ ${editor.def.shortName} はすでに起動しています。`,
      );
      return;
    }

    try {
      this.launchProcess(editor.command, targetPath);
      const folderPart = targetPath ? `\n📁 ${path.basename(targetPath)}` : '';
      await this.lineClient.sendPush(
        userId,
        `✅ ${editor.def.shortName} を起動しました${folderPart}`,
      );
      logger.info('Editor launched', {
        editor: editor.def.shortName,
        targetPath: targetPath ?? '(none)',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.lineClient.sendPush(userId, `❌ 起動に失敗しました: ${msg}`);
      logger.error('Editor launch failed', { editor: editor.def.shortName, err: msg });
    }
  }

  /** Show which editors are installed and whether they are currently running */
  async handleStatus(userId: string): Promise<void> {
    const statuses = await this.getAllStatuses();
    const installed = statuses.filter((s) => s.installed);

    if (installed.length === 0) {
      await this.lineClient.sendPush(
        userId,
        '❌ 対応エディターが見つかりませんでした。\n' +
        '対応: VSCode / Cursor / VS Code Insiders',
      );
      return;
    }

    const lines = ['💻 エディター状況:', ''];
    for (const s of statuses) {
      if (!s.installed) continue;
      const runLabel = s.running ? '🟢 起動中' : '⚪ 停止中';
      lines.push(`${runLabel} ${s.shortName}`);
    }
    lines.push('');
    lines.push('コマンド: 「VSCodeを開いて」「Cursorを開いて」');
    lines.push('「{リポジトリ名}をVSCodeで開いて」');

    await this.lineClient.sendPush(userId, lines.join('\n'));
  }
}
