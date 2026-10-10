/* oxlint-disable */
const { app, BrowserWindow, dialog } = require('electron');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = 8787;
let workerProcess;

function projectRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'app');
  return path.resolve(__dirname, '..');
}

function startWorker() {
  const authKeys = [
    'AUTH_MANAGER_ACCOUNT', 'AUTH_MANAGER_PASSWORD',
    'AUTH_INITIAL_ADMIN_ACCOUNT', 'AUTH_INITIAL_ADMIN_PASSWORD',
  ];
  const missing = authKeys.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error('请先设置本机环境变量：' + missing.join(', '));
  const root = projectRoot();
  const configPath = path.join(root, 'dist', 'server', 'wrangler.json');
  const wranglerPath = path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
  const nodeBinary = app.isPackaged
    ? path.join(root, 'electron', 'node-runtime', 'node.exe')
    : 'node';
  const persistPath = path.join(app.getPath('userData'), 'data');
  const logPath = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(persistPath, { recursive: true });
  fs.mkdirSync(logPath, { recursive: true });

  const args = [
    wranglerPath,
    'dev',
    '--config', configPath,
    '--ip', '127.0.0.1',
    '--port', String(PORT),
    '--persist-to', persistPath,
    '--show-interactive-dev-session', 'false',
    ...authKeys.flatMap((key) => ['--var', key + ':' + process.env[key]]),
    '--var', 'LOCAL_MODE:1',
  ];
  const logFile = fs.createWriteStream(path.join(logPath, 'server.log'), { flags: 'a' });
  workerProcess = spawn(nodeBinary, args, {
    cwd: root,
    env: {
      ...process.env,
      WRANGLER_WRITE_LOGS: 'false',
      WRANGLER_LOG_PATH: logPath,
      MINIFLARE_REGISTRY_PATH: path.join(persistPath, 'registry'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  workerProcess.stdout.pipe(logFile);
  workerProcess.stderr.pipe(logFile);
  workerProcess.on('error', (error) => {
    dialog.showErrorBox('启动失败', `本地数据服务启动失败：${error.message}`);
  });
  return workerProcess;
}

function initializeDatabase() {
  const root = projectRoot();
  const nodeBinary = app.isPackaged
    ? path.join(root, 'electron', 'node-runtime', 'node.exe')
    : 'node';
  const userData = app.getPath('userData');
  const persistPath = path.join(userData, 'data');
  const marker = path.join(persistPath, 'schema-ready');
  if (fs.existsSync(marker)) return;
  fs.mkdirSync(persistPath, { recursive: true });
  const migrationDir = path.join(root, 'dist', '.openai', 'drizzle');
  const migrationFiles = fs.readdirSync(migrationDir)
    .filter((name) => /^\d+_.*\.sql$/.test(name))
    .sort();
  const sql = migrationFiles
    .map((name) => fs.readFileSync(path.join(migrationDir, name), 'utf8'))
    .join('\n')
    .replace(/--> statement-breakpoint/g, '\n');
  const migrationFile = path.join(persistPath, 'initial-schema.sql');
  fs.writeFileSync(migrationFile, sql, 'utf8');
  const result = spawnSync(nodeBinary, [
    path.join(root, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    'd1', 'execute', 'DB', '--local', '--config', path.join(root, 'dist', 'server', 'wrangler.json'),
    '--persist-to', persistPath, '--file', migrationFile,
  ], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || '数据库初始化失败').slice(-2000));
  }
  fs.writeFileSync(marker, new Date().toISOString(), 'utf8');
}

function stopWorker() {
  if (!workerProcess || workerProcess.killed) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(workerProcess.pid), '/t', '/f'], { windowsHide: true });
  } else {
    workerProcess.kill('SIGTERM');
  }
  workerProcess = undefined;
}

function waitForServer(timeoutMs = 30000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const request = http.get(`http://127.0.0.1:${PORT}/`, (response) => {
        response.resume();
        resolve();
      });
      request.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) reject(new Error('本地服务启动超时。'));
        else setTimeout(check, 250);
      });
    };
    check();
  });
}

async function createWindow() {
  try {
    initializeDatabase();
    startWorker();
  } catch (error) {
    dialog.showErrorBox('初始化失败', error instanceof Error ? error.message : '本地数据库初始化失败。');
    app.quit();
    return;
  }
  try {
    await waitForServer();
  } catch (error) {
    dialog.showErrorBox('启动失败', error instanceof Error ? error.message : '本地服务启动失败。');
    app.quit();
    return;
  }
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: '雀庄会员储值',
    backgroundColor: '#f2f4f7',
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  await window.loadURL(`http://127.0.0.1:${PORT}`);
}

void app.whenReady().then(createWindow);
app.on('window-all-closed', () => { stopWorker(); app.quit(); });
app.on('before-quit', stopWorker);
