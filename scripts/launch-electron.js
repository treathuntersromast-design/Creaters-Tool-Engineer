const { spawn } = require('child_process');
const path = require('path');
const electron = require('electron');

const mainFile = process.argv[2];
if (!mainFile) {
  console.error('Usage: node scripts/launch-electron.js <main-file>');
  process.exit(1);
}

// ELECTRON_RUN_AS_NODE=1 が親プロセスから引き継がれると Electron が
// Node.js 互換モードで起動し Electron API が使えなくなるため除外する
const env = { ...process.env };
delete env['ELECTRON_RUN_AS_NODE'];

const proc = spawn(String(electron), [path.resolve(mainFile)], {
  stdio: 'inherit',
  env,
});

proc.on('close', (code) => process.exit(code ?? 0));
proc.on('error', (err) => {
  console.error('Failed to start electron:', err.message);
  process.exit(1);
});
