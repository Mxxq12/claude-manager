import { app, BrowserWindow, ipcMain, dialog, Notification } from 'electron';
import path from 'path';
import { SessionManager } from './session-manager';
import { IPC } from '../src/types';

let mainWindow: BrowserWindow | null = null;
const sessionManager = new SessionManager();

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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
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
    properties: ['openDirectory'],
  });
  return result.canceled ? null : result.filePaths[0];
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
      const body = payload.idleSubStatus === 'approval' ? 'Waiting for approval' : 'Task completed';
      new Notification({ title: session.name, body }).show();
      app.dock?.bounce('informational');
    }
  }
});

sessionManager.on('closed', (payload) => {
  mainWindow?.webContents.send(IPC.SESSION_CLOSED, payload);
});
