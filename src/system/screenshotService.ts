import { execFile } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';

const execFileAsync = promisify(execFile);

export interface ScreenshotResult {
  ok: boolean;
  filePath: string;
  filename: string;
  error?: string;
}

async function runPowerShell(script: string, timeoutMs = 15_000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NonInteractive', '-NoProfile', '-EncodedCommand', encoded],
    { timeout: timeoutMs, encoding: 'utf-8' },
  );
  return stdout.trim();
}

/**
 * デスクトップ全体のスクリーンショットを撮影して保存する。
 * @param screenshotsDir 保存先ディレクトリ（なければ自動作成）
 */
export async function takeScreenshot(screenshotsDir: string): Promise<ScreenshotResult> {
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const now = new Date();
  const ts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    '_',
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0'),
  ].join('');

  const filename = `screenshot_${ts}.png`;
  const filePath = path.join(screenshotsDir, filename);
  // バックスラッシュをエスケープ
  const escaped = filePath.replace(/\\/g, '\\\\');

  if (process.platform !== 'win32') {
    return { ok: false, filePath, filename, error: 'Windows 以外ではスクリーンショットは非対応です。' };
  }

  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $screen   = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bitmap   = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
    $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
    $graphics.CopyFromScreen($screen.Location, [System.Drawing.Point]::Empty, $screen.Size)
    $bitmap.Save("${escaped}")
    $graphics.Dispose()
    $bitmap.Dispose()
    Write-Output "OK"
  `;

  try {
    const out = await runPowerShell(script);
    if (!out.includes('OK') || !fs.existsSync(filePath)) {
      return { ok: false, filePath, filename, error: '撮影後にファイルが見つかりませんでした。' };
    }
    return { ok: true, filePath, filename };
  } catch (err) {
    return { ok: false, filePath, filename, error: String(err).slice(0, 300) };
  }
}

/** ディレクトリ内の古いスクリーンショットを削除（直近 N 件だけ残す） */
export function pruneScreenshots(screenshotsDir: string, keep = 20): void {
  if (!fs.existsSync(screenshotsDir)) return;
  const files = fs.readdirSync(screenshotsDir)
    .filter((f) => f.startsWith('screenshot_') && f.endsWith('.png'))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(screenshotsDir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  files.slice(keep).forEach(({ name }) => {
    try { fs.unlinkSync(path.join(screenshotsDir, name)); } catch { /* ignore */ }
  });
}
