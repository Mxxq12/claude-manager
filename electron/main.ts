import { app, BrowserWindow, ipcMain, dialog, Notification, nativeImage, Menu, shell } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { execSync } from 'child_process';
import { SessionManager } from './session-manager';

// Fix environment when launched from Finder (macOS doesn't inherit shell env vars like PATH, HTTPS_PROXY, etc.)
if (process.platform === 'darwin' && !process.env.PATH?.includes('/opt/homebrew')) {
  try {
    const shellEnv = execSync('/bin/zsh -ilc "env"', { encoding: 'utf8' }).trim();
    for (const line of shellEnv.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        const key = line.substring(0, idx);
        const value = line.substring(idx + 1);
        process.env[key] = value;
      }
    }
  } catch (_) {
    process.env.PATH = `/opt/homebrew/bin:/usr/local/bin:${process.env.PATH}`;
  }
}

const IPC = {
  SESSION_CREATE: 'session:create',
  SESSION_CREATED: 'session:created',
  SESSION_INPUT: 'session:input',
  SESSION_DATA: 'session:data',
  SESSION_STATUS: 'session:status',
  SESSION_CLOSE: 'session:close',
  SESSION_CLOSED: 'session:closed',
  SESSION_RENAME: 'session:rename',
  SESSION_REQUEST_BUFFER: 'session:request-buffer',
  SESSION_BUFFER_DATA: 'session:buffer-data',
} as const;

let mainWindow: BrowserWindow | null = null;
const sessionManager = new SessionManager();

// --- Hook HTTP Server ---
// Claude Code hooks will POST to this server to report status changes
const hookServer = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://localhost`);
  const parts = url.pathname.split('/').filter(Boolean);
  // GET /idle/:sessionId or /busy/:sessionId
  if (parts.length === 2) {
    const [action, sessionId] = parts;
    if (action === 'idle') {
      sessionManager.setSessionStatus(sessionId, 'idle', 'input');
    } else if (action === 'busy') {
      sessionManager.setSessionStatus(sessionId, 'busy');
    } else if (action === 'approval') {
      sessionManager.setSessionStatus(sessionId, 'idle', 'approval');
    }
  }
  res.writeHead(200);
  res.end('ok');
});

function startHookServer(): Promise<number> {
  return new Promise((resolve) => {
    hookServer.listen(0, '127.0.0.1', () => {
      const addr = hookServer.address() as { port: number };
      console.log(`Hook server listening on port ${addr.port}`);
      resolve(addr.port);
    });
  });
}

// --- Setup hooks in user settings ---
function setupClaudeHooks(port: number) {
  const settingsPath = path.join(os.homedir(), '.claude', 'settings.json');
  let settings: any = {};
  try {
    const raw = fs.readFileSync(settingsPath, 'utf-8');
    settings = JSON.parse(raw);
    if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
      console.error('settings.json is not a valid object, resetting hooks section');
      settings = {};
    }
  } catch (err) {
    console.warn('Could not read settings.json, will create:', (err as Error).message);
  }

  if (!settings.hooks || typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) {
    settings.hooks = {};
  }

  const stopHookCmd = `[ -n "$CLAUDE_MANAGER_PORT" ] && curl -s "http://127.0.0.1:$CLAUDE_MANAGER_PORT/idle/$CLAUDE_MANAGER_SESSION_ID" || true`;
  const busyHookCmd = `[ -n "$CLAUDE_MANAGER_PORT" ] && curl -s "http://127.0.0.1:$CLAUDE_MANAGER_PORT/busy/$CLAUDE_MANAGER_SESSION_ID" || true`;
  const approvalHookCmd = `[ -n "$CLAUDE_MANAGER_PORT" ] && curl -s "http://127.0.0.1:$CLAUDE_MANAGER_PORT/approval/$CLAUDE_MANAGER_SESSION_ID" || true`;

  // Helper to check if our hook already exists
  const hasManagerHook = (hookArray: any[]) =>
    hookArray?.some((h: any) => h.hooks?.some((hh: any) => hh.command?.includes('CLAUDE_MANAGER_PORT')));

  // Stop hook -> idle
  if (!Array.isArray(settings.hooks.Stop)) settings.hooks.Stop = [];
  if (!hasManagerHook(settings.hooks.Stop)) {
    settings.hooks.Stop.push({
      hooks: [{ type: 'command', command: stopHookCmd, timeout: 5 }],
    });
  }

  // UserPromptSubmit hook -> busy
  if (!Array.isArray(settings.hooks.UserPromptSubmit)) settings.hooks.UserPromptSubmit = [];
  if (!hasManagerHook(settings.hooks.UserPromptSubmit)) {
    settings.hooks.UserPromptSubmit.push({
      hooks: [{ type: 'command', command: busyHookCmd, timeout: 5 }],
    });
  }

  // PermissionRequest hook -> approval
  if (!Array.isArray(settings.hooks.PermissionRequest)) settings.hooks.PermissionRequest = [];
  if (!hasManagerHook(settings.hooks.PermissionRequest)) {
    settings.hooks.PermissionRequest.push({
      hooks: [{ type: 'command', command: approvalHookCmd, timeout: 5 }],
    });
  }

  // Disable sandbox network restrictions for Claude Manager sessions
  if (!settings.sandbox) settings.sandbox = {};
  settings.sandbox.enabled = false;

  try {
    // Ensure .claude directory exists
    const claudeDir = path.join(os.homedir(), '.claude');
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }
    console.log(`[Claude Manager] 写入 hooks 到 ${settingsPath}（用于会话状态检测）`);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
  } catch (err) {
    console.error('Failed to write settings.json:', (err as Error).message);
  }
}

// --- Window ---
function createWindow() {
  const iconPath = path.join(__dirname, '../assets/icon.png');
  const icon = nativeImage.createFromPath(iconPath);

  if (process.platform === 'darwin' && !icon.isEmpty()) {
    app.dock?.setIcon(icon);
  }

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Claude Manager',
    icon: iconPath,
    backgroundColor: '#181825',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 12, y: 10 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  // Intercept links: open external URLs in the system default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Allow loading the app itself
    const appOrigins = ['http://localhost:5173', 'file://'];
    if (!appOrigins.some((origin) => url.startsWith(origin))) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

// Enable high-DPI support for Retina displays
app.commandLine.appendSwitch('high-dpi-support', '1');
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  const port = await startHookServer();
  sessionManager.setHookServerPort(port);
  setupClaudeHooks(port);
  createWindow();

  // Check if claude CLI is available
  const claudeExists = ['/opt/homebrew/bin/claude', '/usr/local/bin/claude'].some(p => fs.existsSync(p));
  if (!claudeExists) {
    try { execSync('which claude', { timeout: 3000 }); } catch {
      dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        title: '未找到 Claude CLI',
        message: '未检测到 Claude CLI，请先安装后再使用。',
        detail: '安装方式：npm install -g @anthropic-ai/claude-code\n\n安装后请重启应用。',
      });
    }
  }
});

app.on('window-all-closed', async () => {
  hookServer.close();
  await sessionManager.dispose();
  app.quit();
});

// IPC: Renderer -> Main
ipcMain.on(IPC.SESSION_CREATE, (_, payload: { cwd: string }) => {
  let cwd = payload.cwd;
  try {
    if (!fs.statSync(cwd).isDirectory()) {
      cwd = path.dirname(cwd);
    }
  } catch {}
  console.log(`[SESSION_CREATE] cwd=${cwd}, existing sessions:`, sessionManager.getAllSessions().map(s => s.cwd));
  const existingId = sessionManager.getSessionIdForCwd(cwd);
  if (existingId) {
    console.log(`[SESSION_CREATE] Already exists: ${existingId}, switching`);
    safeSend('session:switch-to', { id: existingId });
    return;
  }
  console.log(`[SESSION_CREATE] Creating new session for ${cwd}`);
  sessionManager.createSession(cwd);
});

ipcMain.on(IPC.SESSION_INPUT, (_, payload: { id: string; data: string }) => {
  if (!payload.id || !sessionManager.getSession(payload.id)) return;
  sessionManager.sendInput(payload.id, payload.data);
});

ipcMain.on(IPC.SESSION_CLOSE, (_, payload: { id: string }) => {
  if (!payload.id) return;
  sessionManager.closeSession(payload.id);
});

ipcMain.on(IPC.SESSION_RENAME, (_, payload: { id: string; name: string }) => {
  if (!payload.id || !payload.name || !sessionManager.getSession(payload.id)) return;
  sessionManager.renameSession(payload.id, payload.name);
});

ipcMain.on('session:resize', (_, payload: { id: string; cols: number; rows: number }) => {
  sessionManager.resizePty(payload.id, payload.cols, payload.rows);
});

ipcMain.on('session:clear-buffer', (_, payload: { id: string }) => {
  sessionManager.clearBuffer(payload.id);
});

// Managed mode (托管模式)
ipcMain.handle('managed:start', (_, payload: { executorId: string }) => {
  return sessionManager.startManagedForSession(payload.executorId);
});

ipcMain.on('managed:stop', (_, payload: { executorId: string }) => {
  sessionManager.stopManagedForSession(payload.executorId);
});

ipcMain.handle('managed:get-controller', (_, payload: { executorId: string }) => {
  return sessionManager.getManagedControllerIdForSession(payload.executorId);
});

ipcMain.on('managed:pause', (_, payload: { executorId: string }) => {
  sessionManager.pauseManagedForSession(payload.executorId);
});

ipcMain.on('managed:resume', (_, payload: { executorId: string }) => {
  sessionManager.resumeManagedForSession(payload.executorId);
});

ipcMain.handle('managed:is-auto', (_, payload: { executorId: string }) => {
  return sessionManager.isManagedAutoMode(payload.executorId);
});

sessionManager.on('managed-created', (payload) => {
  safeSend('managed:created', payload);
});

sessionManager.on('managed-stopped', (payload) => {
  safeSend('managed:stopped', payload);
});

sessionManager.on('managed-paused', (payload) => {
  safeSend('managed:paused', payload);
});

sessionManager.on('managed-resumed', (payload) => {
  safeSend('managed:resumed', payload);
});

sessionManager.on('managed-started', (payload) => {
  safeSend('managed:auto-started', payload);
});

sessionManager.on('managed-completed', (payload) => {
  safeSend('managed:completed', payload);
});

sessionManager.on('managed-transfer', (payload) => {
  safeSend('managed:transfer', payload);
});

ipcMain.handle('fs:is-directory', (_, filePath: string) => {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
});

ipcMain.handle('clipboard:save-image', () => {
  const { clipboard } = require('electron');
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  const tmpDir = path.join(os.tmpdir(), 'claude-manager');
  if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
  const filename = `clipboard-${Date.now()}.png`;
  const filePath = path.join(tmpDir, filename);
  fs.writeFileSync(filePath, image.toPNG());
  return filePath;
});

ipcMain.handle(IPC.SESSION_REQUEST_BUFFER, (_, payload: { id: string }) => {
  const buffer = sessionManager.getBuffer(payload.id);
  return buffer;
});

ipcMain.handle('session:confirm-create', async (_, payload: { filePath: string }) => {
  let cwd = payload.filePath;
  try {
    if (!fs.statSync(cwd).isDirectory()) {
      cwd = path.dirname(cwd);
    }
  } catch {
    return false;
  }
  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'question',
    buttons: ['取消', '创建'],
    defaultId: 1,
    cancelId: 0,
    title: '新建会话',
    message: `是否为以下项目创建新会话？`,
    detail: cwd,
  });
  if (result.response === 1) {
    const existingId = sessionManager.getSessionIdForCwd(cwd);
    if (existingId) {
      safeSend('session:switch-to', { id: existingId });
    } else {
      sessionManager.createSession(cwd);
    }
    return true;
  }
  return false;
});

ipcMain.handle('dialog:selectDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('get-recent-projects', async () => {
  const projectsDir = path.join(os.homedir(), '.claude', 'projects');
  try {
    const entries = fs.readdirSync(projectsDir);
    const projects = entries
      .map((entry) => {
        const projectPath = '/' + entry.replace(/^-/, '').replace(/-/g, '/');
        const name = path.basename(projectPath);
        try {
          // Validate path exists and is a directory on disk
          if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
            return null;
          }
          const stat = fs.statSync(path.join(projectsDir, entry));
          return { path: projectPath, name, mtime: stat.mtimeMs };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a: any, b: any) => b.mtime - a.mtime)
      .map(({ path: p, name }: any) => ({ path: p, name }));
    return projects;
  } catch {
    return [];
  }
});

ipcMain.on('window:set-title', (_, title: string) => {
  mainWindow?.setTitle(title);
});

ipcMain.on('auto-approve:set-global', (_, enabled: boolean) => {
  sessionManager.setAutoApproveGlobal(enabled);
});

ipcMain.handle('auto-approve:get-global', () => {
  return sessionManager.getAutoApproveGlobal();
});

ipcMain.on('auto-approve:set-session', (_, payload: { id: string; enabled: boolean }) => {
  sessionManager.setAutoApproveSession(payload.id, payload.enabled);
});

ipcMain.on('session:context-menu', (_, payload: { id: string; source?: string }) => {
  const items: Electron.MenuItemConstructorOptions[] = [];
  if (payload.source === 'terminal') {
    items.push({
      label: '清除终端',
      click: () => { mainWindow?.webContents.send('session:clear-terminal', { id: payload.id }); },
    });
  } else {
    items.push({
      label: '重命名',
      click: () => { mainWindow?.webContents.send('session:rename-request', { id: payload.id }); },
    });
    const session = sessionManager.getSession(payload.id);
    if (session) {
      items.push({
        label: '打开目录',
        click: () => { shell.openPath(session.cwd); },
      });
      items.push({
        label: '导出历史',
        click: async () => {
          const buffer = sessionManager.getBuffer(payload.id);
          if (!buffer || buffer.length === 0) return;
          const result = await dialog.showSaveDialog(mainWindow!, {
            title: '导出会话历史',
            defaultPath: path.join(session.cwd, `${session.name}-${new Date().toISOString().slice(0, 10)}.txt`),
            filters: [{ name: '文本文件', extensions: ['txt'] }],
          });
          if (result.canceled || !result.filePath) return;
          const decoder = new TextDecoder();
          const text = buffer.map((chunk) => decoder.decode(new Uint8Array(chunk))).join('');
          // Strip ANSI escape codes for readable output
          const clean = text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
          fs.writeFileSync(result.filePath, clean, 'utf-8');
          shell.showItemInFolder(result.filePath);
        },
      });
    }
  }
  Menu.buildFromTemplate(items).popup();
});

ipcMain.on('shell:open-path', (_, payload: { path: string }) => {
  const resolved = payload.path.startsWith('~') ? payload.path.replace('~', os.homedir()) : payload.path;
  shell.openPath(resolved);
});

ipcMain.on('shell:open-external', (_, payload: { url: string }) => {
  shell.openExternal(payload.url);
});

// SessionManager -> Renderer
function safeSend(channel: string, payload: unknown) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

sessionManager.on('created', (payload) => {
  safeSend(IPC.SESSION_CREATED, payload);
});

sessionManager.on('data', (payload) => {
  safeSend(IPC.SESSION_DATA, payload);
});

sessionManager.on('status', (payload) => {
  safeSend(IPC.SESSION_STATUS, payload);

  if (payload.status === 'idle' && mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) {
    const session = sessionManager.getSession(payload.id);
    if (session) {
      const body = payload.idleSubStatus === 'approval' ? '等待确认' : '任务完成';
      new Notification({ title: session.name, body }).show();
      app.dock?.bounce('informational');
    }
  }
});

sessionManager.on('closed', (payload) => {
  safeSend(IPC.SESSION_CLOSED, payload);
});

sessionManager.on('usage', (payload) => {
  safeSend('session:usage', payload);
});
