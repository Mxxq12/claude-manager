import { app, BrowserWindow, ipcMain, dialog, Notification, nativeImage, Menu } from 'electron';
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
    settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {}

  if (!settings.hooks) settings.hooks = {};

  const stopHookCmd = `[ -n "$CLAUDE_MANAGER_PORT" ] && curl -s "http://127.0.0.1:$CLAUDE_MANAGER_PORT/idle/$CLAUDE_MANAGER_SESSION_ID" || true`;
  const busyHookCmd = `[ -n "$CLAUDE_MANAGER_PORT" ] && curl -s "http://127.0.0.1:$CLAUDE_MANAGER_PORT/busy/$CLAUDE_MANAGER_SESSION_ID" || true`;
  const approvalHookCmd = `[ -n "$CLAUDE_MANAGER_PORT" ] && curl -s "http://127.0.0.1:$CLAUDE_MANAGER_PORT/approval/$CLAUDE_MANAGER_SESSION_ID" || true`;

  // Helper to check if our hook already exists
  const hasManagerHook = (hookArray: any[]) =>
    hookArray?.some((h: any) => h.hooks?.some((hh: any) => hh.command?.includes('CLAUDE_MANAGER_PORT')));

  // Stop hook -> idle
  if (!settings.hooks.Stop) settings.hooks.Stop = [];
  if (!hasManagerHook(settings.hooks.Stop)) {
    settings.hooks.Stop.push({
      hooks: [{ type: 'command', command: stopHookCmd, timeout: 5 }],
    });
  }

  // UserPromptSubmit hook -> busy
  if (!settings.hooks.UserPromptSubmit) settings.hooks.UserPromptSubmit = [];
  if (!hasManagerHook(settings.hooks.UserPromptSubmit)) {
    settings.hooks.UserPromptSubmit.push({
      hooks: [{ type: 'command', command: busyHookCmd, timeout: 5 }],
    });
  }

  // PermissionRequest hook -> approval
  if (!settings.hooks.PermissionRequest) settings.hooks.PermissionRequest = [];
  if (!hasManagerHook(settings.hooks.PermissionRequest)) {
    settings.hooks.PermissionRequest.push({
      hooks: [{ type: 'command', command: approvalHookCmd, timeout: 5 }],
    });
  }

  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
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
    },
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
});

app.on('window-all-closed', () => {
  hookServer.close();
  sessionManager.dispose();
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
  sessionManager.createSession(cwd);
});

ipcMain.on(IPC.SESSION_INPUT, (_, payload: { id: string; data: string }) => {
  sessionManager.sendInput(payload.id, payload.data);
});

ipcMain.on(IPC.SESSION_CLOSE, (_, payload: { id: string }) => {
  sessionManager.closeSession(payload.id);
});

ipcMain.on(IPC.SESSION_RENAME, (_, payload: { id: string; name: string }) => {
  sessionManager.renameSession(payload.id, payload.name);
});

ipcMain.on('session:resize', (_, payload: { id: string; cols: number; rows: number }) => {
  sessionManager.resizePty(payload.id, payload.cols, payload.rows);
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
    sessionManager.createSession(cwd);
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
          fs.accessSync(projectPath);
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
  }
  Menu.buildFromTemplate(items).popup();
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
