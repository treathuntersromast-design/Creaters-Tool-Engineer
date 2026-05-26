import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import { spawn, spawnSync, ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

// パッケージ済み: userData内の.env（初回はEXE隣からコピー）/ 開発時: プロジェクトルートの.env
// app?.isPackaged: モジュール読み込み時点で app が未初期化の場合も安全に dev 扱いにする
function resolveEnvPath(): string {
  if (!app?.isPackaged) return path.join(__dirname, '..', '.env');

  const userDataEnv = path.join(app.getPath('userData'), '.env');
  const exeDirEnv   = path.join(path.dirname(process.execPath), '.env');

  if (fs.existsSync(userDataEnv)) return userDataEnv;

  // 初回起動: EXE隣の.envをuserDataへコピーして永続化
  if (fs.existsSync(exeDirEnv)) {
    fs.copyFileSync(exeDirEnv, userDataEnv);
    return userDataEnv;
  }

  return exeDirEnv;
}

const resolvedEnvPath = resolveEnvPath();
dotenv.config({ path: resolvedEnvPath });
// サーバーコードが設定ファイルパスを参照できるよう渡す
process.env['ENV_FILE_PATH'] = resolvedEnvPath;

// GIT_REPOS_PATHS 専用ファイル（PC固有のため .env とは別管理・gitignore 対象）
function resolveReposPathsFile(): string {
  if (!app?.isPackaged) return path.join(__dirname, '..', 'repos-paths.local');
  return path.join(app.getPath('userData'), 'repos-paths.local');
}

function loadReposPaths(): void {
  const filePath = resolveReposPathsFile();
  if (!fs.existsSync(filePath)) return;
  const value = fs.readFileSync(filePath, 'utf8').trim();
  if (value) process.env['GIT_REPOS_PATHS'] = value;
}

function saveReposPathsToFile(paths: string): void {
  fs.writeFileSync(resolveReposPathsFile(), paths, 'utf8');
}

// 起動時に repos-paths.local を読み込む（.env の GIT_REPOS_PATHS より優先）
loadReposPaths();

let adminBase = '';
let serverPort = 0;
let ngrokDomain = '';
let mainWindow: BrowserWindow | null = null;
let ngrokProcess: ChildProcess | null = null;
let serverClose: (() => Promise<void>) | null = null;

// クラッシュダイアログを防ぎ、ログ欄に表示する
process.on('uncaughtException', (err) => {
  const msg = `[FATAL] 予期しないエラー: ${err.message}\n${err.stack ?? ''}`;
  console.error(msg);
  sendLog(msg);
});

function sendLog(msg: string): void {
  mainWindow?.webContents.send('log', msg);
}

// サーバーをElectronのメインプロセス内で直接起動（システムNode.js不要）
async function startServer(): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { startServer: startAppServer } = require('../dist/index') as {
    startServer: () => Promise<{ port: number; close: () => Promise<void> }>;
  };
  const handle = await startAppServer();
  serverClose = handle.close;
  return handle.port;
}

function notifyServerInfo(): void {
  mainWindow?.webContents.send('server:info', {
    port: serverPort,
    ngrokDomain,
    webhookUrl: ngrokDomain ? `https://${ngrokDomain}/webhook` : '',
  });
}

function startNgrok(port: number): void {
  const domain   = process.env['NGROK_DOMAIN'];
  const authtoken = process.env['NGROK_AUTHTOKEN'];
  if (!domain) {
    sendLog('[ngrok] NGROK_DOMAIN が未設定のため自動起動をスキップします');
    return;
  }

  ngrokDomain = domain;

  // 前回のngrokプロセスが残っていたら強制終了（ERR_NGROK_334対策）
  spawnSync('taskkill', ['/F', '/IM', 'ngrok.exe'], { stdio: 'ignore' });

  const args = ['http', `--url=${domain}`, String(port)];

  // NGROK_AUTHTOKEN は環境変数で渡す（--authtoken フラグは http サブコマンドでは無効）
  const spawnEnv = { ...process.env };
  if (authtoken) spawnEnv['NGROK_AUTHTOKEN'] = authtoken;

  ngrokProcess = spawn('ngrok', args, { stdio: 'pipe', env: spawnEnv });

  let tunnelConnected = false;

  function checkSuccess(text: string): void {
    if (tunnelConnected) return;
    // ngrok v3: JSON形式 {"msg":"started tunnel"} またはプレーンテキスト
    const isSuccess = text.includes('"started tunnel"') ||
                      text.includes('started tunnel') ||
                      text.includes(`https://${domain}`);
    // エラーキーワードが含まれる場合は成功扱いしない
    const isError = text.toLowerCase().includes('error') ||
                    text.toLowerCase().includes('err_ngrok') ||
                    text.toLowerCase().includes('failed');
    if (isSuccess && !isError) {
      tunnelConnected = true;
      sendLog(`[ngrok] トンネル接続完了: https://${domain}/webhook`);
      notifyServerInfo();
    }
  }

  ngrokProcess.stdout?.on('data', (data: Buffer) => {
    const text = data.toString().trim();
    if (text) sendLog(`[ngrok] ${text}`);
    checkSuccess(text);
  });

  ngrokProcess.stderr?.on('data', (data: Buffer) => {
    // stderr はすべてログに流す（エラー内容を確認できるように）
    const text = data.toString().trim();
    if (text) sendLog(`[ngrok] ${text}`);
    checkSuccess(text);
  });

  ngrokProcess.on('exit', (code) => {
    if (code !== 0) {
      sendLog(`[ngrok エラー] 終了コード ${code}。NGROK_AUTHTOKEN と NGROK_DOMAIN が正しいか確認してください。`);
    } else {
      sendLog(`[ngrok] 終了 code=${code}`);
    }
    ngrokProcess = null;
  });

  ngrokProcess.on('error', (err) => {
    sendLog(`[ngrok エラー] 起動失敗: ${err.message}（ngrokがインストール済みか確認してください）`);
    ngrokProcess = null;
  });

  sendLog(`[ngrok] 起動中... → https://${domain}`);
  notifyServerInfo();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 560,
    height: 860,
    resizable: true,
    minWidth: 420,
    minHeight: 600,
    title: 'Creaters Tool Engineer',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.setMenuBarVisibility(false);
  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── Setup IPC handlers ───────────────────────────────────────────────────────

ipcMain.handle('setup:isFirstRun', () => {
  // repos-paths.local が存在しなければ初回とみなす
  return !fs.existsSync(resolveReposPathsFile());
});

ipcMain.handle('setup:pickFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory'],
    title: 'プロジェクトフォルダを選択してください',
    buttonLabel: 'このフォルダを選択',
  });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle('setup:saveReposPaths', (_event, paths: string) => {
  try {
    saveReposPathsToFile(paths);
    process.env['GIT_REPOS_PATHS'] = paths;
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle('setup:getReposPaths', () => {
  return process.env['GIT_REPOS_PATHS'] ?? '';
});

// ─── IPC handlers ────────────────────────────────────────────────────────────

ipcMain.handle('admin:getServerInfo', () => ({
  port: serverPort,
  ngrokDomain,
  webhookUrl: ngrokDomain ? `https://${ngrokDomain}/webhook` : '',
}));

ipcMain.handle('admin:getUsers', async () => {
  if (!adminBase) return { users: [], error: 'サーバー起動中...' };
  try {
    const res = await fetch(`${adminBase}/users`);
    if (!res.ok) return { users: [], error: `HTTP ${res.status}` };
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

ipcMain.handle('chat:send', async (_event, text: string, userId: string) => {
  if (!serverPort) return { messages: ['サーバー起動中です。しばらくお待ちください。'] };
  try {
    const res = await fetch(`http://localhost:${serverPort}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, userId }),
    });
    if (!res.ok) return { messages: [`サーバーエラー: HTTP ${res.status}`] };
    return await res.json();
  } catch (err) {
    return { messages: [`接続エラー: ${String(err)}`] };
  }
});

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  createWindow();
  sendLog('起動中...');
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
  if (ngrokProcess) {
    ngrokProcess.kill('SIGTERM');
    ngrokProcess = null;
  }
  const cleanup = serverClose ? serverClose() : Promise.resolve();
  cleanup.finally(() => app.quit());
});
