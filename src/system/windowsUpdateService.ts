import { execFile } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import path from 'path';
import fs from 'fs';

const execFileAsync = promisify(execFile);

export interface WuStatus {
  isWindows: boolean;
  pendingCount: number;
  rebootRequired: boolean;
  pauseExpiry: string | null;
}

export interface PauseResult {
  ok: boolean;
  expiry: string;
  needsAdmin?: boolean;
  error?: string;
}

// PowerShell スクリプトを Base64 エンコードして実行（引数エスケープ問題を回避）
async function runPowerShell(script: string, timeoutMs = 20_000): Promise<string> {
  const encoded = Buffer.from(script, 'utf16le').toString('base64');
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NonInteractive', '-NoProfile', '-EncodedCommand', encoded],
    { timeout: timeoutMs, encoding: 'utf-8' },
  );
  return stdout.trim();
}

// ── 状況確認 ──────────────────────────────────────────────────────────────────

export async function checkWindowsUpdateStatus(): Promise<WuStatus> {
  if (process.platform !== 'win32') {
    return { isWindows: false, pendingCount: 0, rebootRequired: false, pauseExpiry: null };
  }

  const script = `
    $r = @{}

    # 再起動待ち（管理者権限不要）
    $r.RebootCbs = Test-Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending"
    $r.RebootWu  = Test-Path "HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired"
    $r.RebootRequired = $r.RebootCbs -or $r.RebootWu

    # 一時停止期限（読み取りのみ、管理者権限不要）
    $s = Get-ItemProperty -Path "HKLM:\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings" -ErrorAction SilentlyContinue
    $r.PauseExpiry = $s.PauseUpdatesExpiryTime

    # 保留中アップデート（COM 経由）
    try {
      $session = New-Object -ComObject Microsoft.Update.Session
      $search  = $session.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Software'")
      $r.PendingCount = $search.Updates.Count
    } catch {
      $r.PendingCount = -1
    }

    $r | ConvertTo-Json -Compress
  `;

  try {
    const out = await runPowerShell(script, 30_000);
    const data = JSON.parse(out) as {
      RebootRequired: boolean;
      PauseExpiry: string | null;
      PendingCount: number;
    };
    return {
      isWindows: true,
      pendingCount: data.PendingCount ?? 0,
      rebootRequired: data.RebootRequired === true,
      pauseExpiry: data.PauseExpiry ?? null,
    };
  } catch {
    // COM が動かない環境ではレジストリのみで判定
    return { isWindows: true, pendingCount: 0, rebootRequired: false, pauseExpiry: null };
  }
}

// ── 一時停止 ─────────────────────────────────────────────────────────────────

export async function pauseWindowsUpdate(days: number): Promise<PauseResult> {
  if (process.platform !== 'win32') {
    return { ok: false, expiry: '', error: 'Windows 以外では使用できません' };
  }

  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  // Windows が期待する ISO 8601 形式（ミリ秒なし）
  const expiryStr = expiry.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const startStr  = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

  // 管理者権限で直接レジストリ書き込み → 失敗したら一時スクリプト経由で UAC 昇格
  const writeScript = `
    $key  = "HKLM:\\SOFTWARE\\Microsoft\\WindowsUpdate\\UX\\Settings"
    $exp  = "${expiryStr}"
    $now  = "${startStr}"
    Set-ItemProperty -Path $key -Name "PauseUpdatesExpiryTime"         -Value $exp  -ErrorAction Stop
    Set-ItemProperty -Path $key -Name "PauseQualityUpdatesStartTime"   -Value $now  -ErrorAction Stop
    Set-ItemProperty -Path $key -Name "PauseQualityUpdatesEndTime"     -Value $exp  -ErrorAction Stop
    Set-ItemProperty -Path $key -Name "PauseFeatureUpdatesStartTime"   -Value $now  -ErrorAction Stop
    Set-ItemProperty -Path $key -Name "PauseFeatureUpdatesEndTime"     -Value $exp  -ErrorAction Stop
    Write-Output "OK"
  `;

  // まず通常権限で試みる
  try {
    const out = await runPowerShell(writeScript, 10_000);
    if (out.includes('OK')) return { ok: true, expiry: expiryStr };
  } catch (err) {
    const msg = String(err);
    if (!msg.toLowerCase().includes('access') && !msg.toLowerCase().includes('denied') && !msg.toLowerCase().includes('unauthorized')) {
      return { ok: false, expiry: expiryStr, error: msg };
    }
    // アクセス拒否 → 管理者昇格で再試行
  }

  // 一時 .ps1 ファイルを作成して管理者権限で実行（UAC プロンプト表示）
  const tmpScript = path.join(os.tmpdir(), `wu_pause_${Date.now()}.ps1`);
  const scriptContent = writeScript.trim();
  fs.writeFileSync(tmpScript, scriptContent, { encoding: 'utf8' });

  const elevateScript = `
    $proc = Start-Process powershell.exe -Verb RunAs -Wait -PassThru -ArgumentList "-NonInteractive","-NoProfile","-File","${tmpScript.replace(/\\/g, '\\\\')}"
    $proc.ExitCode
  `;

  try {
    const exitCodeStr = await runPowerShell(elevateScript, 30_000);
    const exitCode = parseInt(exitCodeStr.trim(), 10);
    fs.unlink(tmpScript, () => void 0);
    if (exitCode === 0) return { ok: true, expiry: expiryStr };
    return { ok: false, expiry: expiryStr, needsAdmin: true, error: `終了コード: ${exitCode}` };
  } catch (err) {
    fs.unlink(tmpScript, () => void 0);
    return { ok: false, expiry: expiryStr, needsAdmin: true, error: String(err) };
  }
}

// ── 「更新が迫っているか」判定 ────────────────────────────────────────────────

export function isUpdateImminent(status: WuStatus): boolean {
  if (!status.isWindows) return false;
  if (status.rebootRequired) return true;
  // 保留中アップデートが 1 件以上（COM 失敗時は -1）
  return status.pendingCount > 0;
}

// ── ステータス文章化 ──────────────────────────────────────────────────────────

export function formatWuStatus(status: WuStatus, pauseResult?: PauseResult): string {
  if (!status.isWindows) return '⚠️ Windows 以外では Windows Update の制御はできません。';

  const lines: string[] = [];

  if (status.rebootRequired) {
    lines.push('🔄 **再起動待ち**: 適用済みアップデートの反映に再起動が必要です。');
  }

  if (status.pendingCount > 0) {
    lines.push(`📦 **保留中アップデート**: ${status.pendingCount} 件`);
  } else if (status.pendingCount === 0) {
    lines.push('✅ 保留中のアップデートはありません。');
  }

  if (status.pauseExpiry) {
    const d = new Date(status.pauseExpiry);
    const dateStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
    lines.push(`⏸️ 一時停止中（${dateStr} まで）`);
  }

  if (pauseResult) {
    if (pauseResult.ok) {
      const d = new Date(pauseResult.expiry);
      const dateStr = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
      lines.push(`\n✅ Windows Update を ${dateStr} まで一時停止しました。`);
    } else if (pauseResult.needsAdmin) {
      lines.push('\n⚠️ 管理者権限が必要です。\nアプリを右クリック →「管理者として実行」で起動すると自動停止できます。');
    } else {
      lines.push(`\n❌ 停止に失敗しました: ${pauseResult.error ?? '不明なエラー'}`);
    }
  }

  return lines.join('\n') || '✅ Windows Update に問題はありません。';
}
