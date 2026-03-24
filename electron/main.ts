import { app, BrowserWindow, ipcMain, dialog, Notification } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';
import http from 'http';
import { SessionManager } from './session-manager';

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
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Claude Manager',
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
  sessionManager.createSession(payload.cwd);
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

ipcMain.on(IPC.SESSION_REQUEST_BUFFER, (_, payload: { id: string }) => {
  const buffer = sessionManager.getBuffer(payload.id);
  for (const chunk of buffer) {
    mainWindow?.webContents.send(IPC.SESSION_BUFFER_DATA, { id: payload.id, data: chunk });
  }
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

// SessionManager -> Renderer
sessionManager.on('created', (payload) => {
  mainWindow?.webContents.send(IPC.SESSION_CREATED, payload);
});

sessionManager.on('data', (payload) => {
  mainWindow?.webContents.send(IPC.SESSION_DATA, payload);
});

sessionManager.on('status', (payload) => {
  mainWindow?.webContents.send(IPC.SESSION_STATUS, payload);

  if (payload.status === 'idle' && mainWindow && !mainWindow.isFocused()) {
    const session = sessionManager.getSession(payload.id);
    if (session) {
      const body = payload.idleSubStatus === 'approval' ? '等待确认' : '任务完成';
      new Notification({ title: session.name, body }).show();
      app.dock?.bounce('informational');
    }
  }
});

sessionManager.on('closed', (payload) => {
  mainWindow?.webContents.send(IPC.SESSION_CLOSED, payload);
});
