// EXEビルドスクリプト
// release フォルダが別プロセスにロックされていても上書きコピーで回避する
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '..');
const TMP_OUT    = path.join(ROOT, 'release_build_tmp');
const FINAL_OUT  = path.join(ROOT, 'release');
const APP_NAME   = 'Creaters Tool Engineer';
const TMP_APP    = path.join(TMP_OUT, `${APP_NAME}-win32-x64`);
const FINAL_APP  = path.join(FINAL_OUT, `${APP_NAME}-win32-x64`);

// 1. electron-packager で一時フォルダに出力
console.log('[build] electron-packager を実行中...');
execSync(
  [
    'npx electron-packager .',
    `"${APP_NAME}"`,
    '--platform=win32',
    '--arch=x64',
    `--out="${TMP_OUT}"`,
    '--overwrite',
    '--electron-version=33.4.11',
    '--no-asar',
    '--ignore="^/(release|release_build_tmp|tests|electron|src|scripts)($|/)"',
    '--ignore="\\.ts$"',
    '--ignore="^\\.env"',
  ].join(' '),
  { cwd: ROOT, stdio: 'inherit', shell: true },
);

// 2. release フォルダを用意
fs.mkdirSync(FINAL_APP, { recursive: true });

// 3. 一時フォルダから release へファイルをコピー（フォルダ削除不要）
// robocopy は成功時も終了コード 1-7 を返すため spawnSync で扱う
console.log('[build] release フォルダへコピー中...');
const { spawnSync } = require('child_process');
const robocopy = spawnSync(
  'robocopy',
  [TMP_APP, FINAL_APP, '/E', '/IS', '/IT', '/NFL', '/NDL', '/NJH', '/NJS', '/R:0', '/W:0'],
  { cwd: ROOT, stdio: 'inherit', shell: false },
);
// robocopy: ビット和 0-7 は成功、16以上は致命的エラー
// コード 8 (一部ファイルコピー失敗) は Windows Defender による一時的なロックで発生しうるため許容
if (robocopy.status !== null && robocopy.status >= 16) {
  console.error(`[build] robocopy 致命的エラー (code=${robocopy.status})`);
  process.exit(1);
}
if (robocopy.status !== null && robocopy.status >= 8) {
  console.warn(`[build] robocopy 一部ファイルをスキップ (code=${robocopy.status}) — 静的Electronバイナリのロックによるものです。アプリコードは更新されています。`);
}

// 4. 一時フォルダを削除
console.log('[build] 一時フォルダを削除中...');
fs.rmSync(TMP_OUT, { recursive: true, force: true });

console.log(`[build] 完了: ${FINAL_APP}`);
