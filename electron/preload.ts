import { contextBridge, ipcRenderer } from 'electron';

// Inline IPC constants to avoid cross-module import issues in preload
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

const api = {
  createSession(cwd: string) {
    ipcRenderer.send(IPC.SESSION_CREATE, { cwd });
  },
  sendInput(id: string, data: string) {
    ipcRenderer.send(IPC.SESSION_INPUT, { id, data });
  },
  closeSession(id: string) {
    ipcRenderer.send(IPC.SESSION_CLOSE, { id });
  },
  renameSession(id: string, name: string) {
    ipcRenderer.send(IPC.SESSION_RENAME, { id, name });
  },
  requestBuffer(id: string) {
    ipcRenderer.send(IPC.SESSION_REQUEST_BUFFER, { id });
  },
  async selectDirectory() {
    return ipcRenderer.invoke('dialog:selectDirectory');
  },
  async getRecentProjects(): Promise<{ path: string; name: string }[]> {
    return ipcRenderer.invoke('get-recent-projects');
  },
  onSessionCreated(callback: (payload: any) => void) {
    const handler = (_: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on(IPC.SESSION_CREATED, handler);
    return () => ipcRenderer.removeListener(IPC.SESSION_CREATED, handler);
  },
  onSessionData(callback: (payload: any) => void) {
    const handler = (_: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on(IPC.SESSION_DATA, handler);
    return () => ipcRenderer.removeListener(IPC.SESSION_DATA, handler);
  },
  onSessionStatus(callback: (payload: any) => void) {
    const handler = (_: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on(IPC.SESSION_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC.SESSION_STATUS, handler);
  },
  onSessionClosed(callback: (payload: any) => void) {
    const handler = (_: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on(IPC.SESSION_CLOSED, handler);
    return () => ipcRenderer.removeListener(IPC.SESSION_CLOSED, handler);
  },
  onSessionBufferData(callback: (payload: any) => void) {
    const handler = (_: unknown, payload: unknown) => callback(payload);
    ipcRenderer.on(IPC.SESSION_BUFFER_DATA, handler);
    return () => ipcRenderer.removeListener(IPC.SESSION_BUFFER_DATA, handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
