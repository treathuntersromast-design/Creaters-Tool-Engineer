import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { spawn, ChildProcess, execFile } from 'child_process';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

let adminBase = ''; // サーバー起動後に動的セット
let serverPort = 0;
let ngrokDomain = '';
let mainWindow: BrowserWindow | null = null;
let serverProcess: ChildProcess | null = null;
let ngrokProcess: ChildProcess | null = null;

function sendLog(msg: string): void {
  mainWindow?.webContents.send('log', msg);
}

// ─── Node.js 自動インストール ─────────────────────────────────────────────────

/** システムの node が利用可能かチェックし、バージョン文字列を返す。なければ null */
function getNodeVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('node', ['--version'], { timeout: 5000 }, (err, stdout) => {
      resolve(err ? null : stdout.trim());
    });
  });
}

/**
 * winget で Node.js LTS をインストールする。
 * PowerShell を呼び出し、標準出力をログに流す。
 * 成功すれば true、失敗すれば false を返す。
 */
function installNodeViaWinget(): Promise<boolean> {
  return new Promise((resolve) => {
    sendLog('[Node.js] winget でインストールを開始します...');
    const ps = spawn(
      'powershell.exe',
      [
        '-NoProfile', '-NonInteractive', '-Command',
        [
          'winget install OpenJS.NodeJS.LTS',
          '--silent',
          '--accept-package-agreements',
          '--accept-source-agreements',
          '--source winget',
        ].join(' '),
      ],
      { stdio: 'pipe' },
    );

    ps.stdout?.on('data', (d: Buffer) => {
      sendLog(`[Node.js] ${d.toString().trim()}`);
    });
    ps.stderr?.on('data', (d: Buffer) => {
      sendLog(`[Node.js] ${d.toString().trim()}`);
    });
    ps.on('close', (code) => resolve(code === 0));
    ps.on('error', () => resolve(false));
  });
}

/** インストール後、デフォルトパスを process.env.PATH に追加して node を使えるようにする */
function refreshNodePath(): void {
  const defaults = [
    'C:\\Program Files\\nodejs',
    `${process.env['APPDATA'] ?? ''}\\npm`,
  ];
  for (const p of defaults) {
    if (p && !process.env['PATH']?.includes(p)) {
      process.env['PATH'] = `${p};${process.env['PATH'] ?? ''}`;
    }
  }
}

/**
 * Node.js が存在しなければ確認ダイアログを出してインストールを試みる。
 * true = 起動続行可、false = 起動不可（アプリを終了すべき）
 */
async function ensureNodeJs(): Promise<boolean> {
  const version = await getNodeVersion();
  if (version) {
    sendLog(`Node.js ${version} を検出しました`);
    return true;
  }

  sendLog('[警告] Node.js が見つかりません');

  const { response } = await dialog.showMessageBox({
    type: 'question',
    buttons: ['インストール（winget）', '手動でインストール', 'キャンセル'],
    defaultId: 0,
    cancelId: 2,
    title: 'Node.js が必要です',
    message: 'このアプリの動作には Node.js（LTS版）が必要です。',
    detail:
      '「インストール」を選ぶと winget を使って自動でインストールします。\n' +
      '管理者権限の確認（UAC）が表示される場合があります。\n\n' +
      '「手動でインストール」を選ぶと公式サイトを開きます。\n' +
      'インストール後にアプリを再起動してください。',
  });

  if (response === 1) {
    // 手動インストール：公式サイトを開いて終了
    await shell.openExternal('https://nodejs.org/ja/download/');
    sendLog('[Node.js] 公式サイトを開きました。インストール後にアプリを再起動してください。');
    return false;
  }

  if (response === 2) {
    sendLog('[Node.js] キャンセルされました。アプリを終了します。');
    return false;
  }

  // winget インストール
  const installed = await installNodeViaWinget();
  if (!installed) {
    await dialog.showMessageBox({
      type: 'error',
      title: 'インストール失敗',
      message: 'Node.js の自動インストールに失敗しました。',
      detail:
        '公式サイト ( https://nodejs.org ) から手動でインストールしてください。\n' +
        'インストール後にアプリを再起動してください。',
    });
    sendLog('[エラー] Node.js のインストールに失敗しました。手動でインストールしてください: https://nodejs.org');
    await shell.openExternal('https://nodejs.org/ja/download/');
    return false;
  }

  refreshNodePath();

  const newVersion = await getNodeVersion();
  if (newVersion) {
    sendLog(`Node.js ${newVersion} のインストールが完了しました`);
    return true;
  }

  // インストール成功でも PATH 未反映の場合（要再起動）
  await dialog.showMessageBox({
    type: 'info',
    title: 'インストール完了',
    message: 'Node.js のインストールが完了しました。',
    detail: 'アプリを再起動して続行してください。',
  });
  sendLog('[Node.js] インストール完了。アプリを再起動してください。');
  return false;
}

/** サーバーを起動し、割り当てられたポート番号を返す（最大30秒待機） */
function startServer(): Promise<number> {
  return new Promise((resolve, reject) => {
    const serverScript = path.join(__dirname, '..', 'dist', 'index.js');
    serverProcess = spawn('node', [serverScript], {
      env: { ...process.env },
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe',
    });

    const timeout = setTimeout(() => {
      reject(new Error('サーバーの起動がタイムアウトしました'));
    }, 30_000);

    serverProcess.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      // ASSIGNED_PORT=XXXXX を受信したらポート確定
      const match = text.match(/ASSIGNED_PORT=(\d+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(parseInt(match[1]!, 10));
      }
      const trimmed = text.trim();
      if (trimmed) sendLog(trimmed);
    });
    serverProcess.stderr?.on('data', (data: Buffer) => {
      sendLog(`[ERR] ${data.toString().trim()}`);
    });
    serverProcess.on('exit', (code) => {
      clearTimeout(timeout);
      sendLog(`[サーバー終了 code=${code}]`);
      serverProcess = null;
    });
    serverProcess.on('error', (err) => {
      clearTimeout(timeout);
      sendLog(`[ERROR] サーバー起動失敗: ${err.message}`);
      serverProcess = null;
      reject(err);
    });
  });
}

function notifyServerInfo(): void {
  mainWindow?.webContents.send('server:info', {
    port: serverPort,
    ngrokDomain,
    webhookUrl: ngrokDomain ? `https://${ngrokDomain}/webhook` : '',
  });
}

function startNgrok(port: number): void {
  const domain = process.env['NGROK_DOMAIN'];
  if (!domain) {
    sendLog('[ngrok] NGROK_DOMAIN が未設定のため自動起動をスキップします');
    return;
  }

  ngrokDomain = domain;

  ngrokProcess = spawn('ngrok', ['http', `--url=${domain}`, String(port)], {
    stdio: 'pipe',
  });

  ngrokProcess.stdout?.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    if (text) sendLog(`[ngrok] ${text}`);
    if (text.includes('started tunnel') || text.includes(domain)) {
      sendLog(`[ngrok] トンネル接続完了: https://${domain}/webhook`);
      notifyServerInfo();
    }
  });
  ngrokProcess.stderr?.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    if (!text) return;
    if (text.includes('started tunnel') || text.includes(domain)) {
      sendLog(`[ngrok] トンネル接続完了: https://${domain}/webhook`);
      notifyServerInfo();
    } else if (text.includes('error') || text.includes('ERR_')) {
      sendLog(`[ngrok エラー] ${text}`);
    } else {
      sendLog(`[ngrok] ${text}`);
    }
  });
  ngrokProcess.on('exit', (code) => {
    sendLog(`[ngrok終了 code=${code}]`);
    ngrokProcess = null;
  });
  ngrokProcess.on('error', (err) => {
    sendLog(`[ERROR] ngrok起動失敗: ${err.message}`);
    ngrokProcess = null;
  });

  sendLog(`[ngrok] 起動中... → https://${domain}`);
  // Emit info now so UI can show the URL; tunnel may take a moment to connect
  notifyServerInfo();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 700,
    resizable: false,
    title: 'Creaters Tool Engineer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // renderer is always at dist-electron/renderer/ (copied during electron:compile)
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.handle('admin:getServerInfo', () => ({
  port: serverPort,
  ngrokDomain,
  webhookUrl: ngrokDomain ? `https://${ngrokDomain}/webhook` : '',
}));

ipcMain.handle('admin:getUsers', async () => {
  try {
    const res = await fetch(`${adminBase}/users`);
    return await res.json();
  } catch (err) {
    return { users: [], error: String(err) };
  }
});

ipcMain.handle('admin:getStatus', async () => {
  try {
    const res = await fetch(`${adminBase}/session/status`);
    return await res.json();
  } catch (err) {
    return { status: 'INACTIVE', error: String(err) };
  }
});

ipcMain.handle('admin:startSession', async (_event, userId: string) => {
  try {
    const res = await fetch(`${adminBase}/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId }),
    });
    return await res.json();
  } catch (err) {
    return { ok: false, message: String(err) };
  }
});

ipcMain.handle('admin:stopSession', async () => {
  try {
    const res = await fetch(`${adminBase}/session/stop`, { method: 'POST' });
    return await res.json();
  } catch (err) {
    return { ok: false, message: String(err) };
  }
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow();
  sendLog('起動中...');

  const nodeReady = await ensureNodeJs();
  if (!nodeReady) return;

  sendLog('サーバーを起動しています...');
  try {
    const port = await startServer();
    serverPort = port;
    adminBase = `http://localhost:${port}/admin`;
    sendLog(`サーバー起動完了（ポート: ${port}）`);
    notifyServerInfo();
    startNgrok(port);
  } catch (err) {
    sendLog(`[ERROR] サーバー起動失敗: ${err instanceof Error ? err.message : String(err)}`);
  }
});

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
    serverProcess = null;
  }
  if (ngrokProcess) {
    ngrokProcess.kill('SIGTERM');
    ngrokProcess = null;
  }
  app.quit();
});
