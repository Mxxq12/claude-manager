import { contextBridge, ipcRenderer, webUtils } from 'electron';

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
  async requestBuffer(id: string): Promise<Uint8Array[]> {
    return ipcRenderer.invoke(IPC.SESSION_REQUEST_BUFFER, { id });
  },
  resizePty(id: string, cols: number, rows: number) {
    ipcRenderer.send('session:resize', { id, cols, rows });
  },
  clearBuffer(id: string) {
    ipcRenderer.send('session:clear-buffer', { id });
  },
  async saveClipboardImage(): Promise<string | null> {
    return ipcRenderer.invoke('clipboard:save-image');
  },
  async selectDirectory() {
    return ipcRenderer.invoke('dialog:selectDirectory');
  },
  async getRecentProjects(): Promise<{ path: string; name: string }[]> {
    return ipcRenderer.invoke('get-recent-projects');
  },
  async confirmAndCreateSession(filePath: string): Promise<boolean> {
    return ipcRenderer.invoke('session:confirm-create', { filePath });
  },
  setWindowTitle(title: string) {
    ipcRenderer.send('window:set-title', title);
  },
  getPathForFile(file: File): string {
    return webUtils.getPathForFile(file);
  },
  async isDirectory(filePath: string): Promise<boolean> {
    return ipcRenderer.invoke('fs:is-directory', filePath);
  },
  setAutoApproveGlobal(enabled: boolean) {
    ipcRenderer.send('auto-approve:set-global', enabled);
  },
  async getAutoApproveGlobal(): Promise<boolean> {
    return ipcRenderer.invoke('auto-approve:get-global');
  },
  setAutoApproveSession(id: string, enabled: boolean) {
    ipcRenderer.send('auto-approve:set-session', { id, enabled });
  },
  showSessionContextMenu(id: string, source?: string) {
    ipcRenderer.send('session:context-menu', { id, source });
  },
  openPath(p: string) {
    ipcRenderer.send('shell:open-path', { path: p });
  },
  openExternal(url: string) {
    ipcRenderer.send('shell:open-external', { url });
  },
  onSwitchTo(callback: (id: string) => void) {
    const handler = (_: unknown, payload: { id: string }) => callback(payload.id);
    ipcRenderer.on('session:switch-to', handler);
    return () => ipcRenderer.removeListener('session:switch-to', handler);
  },
  onRenameRequest(callback: (id: string) => void) {
    const handler = (_: unknown, payload: { id: string }) => callback(payload.id);
    ipcRenderer.on('session:rename-request', handler);
    return () => ipcRenderer.removeListener('session:rename-request', handler);
  },
  onClearTerminal(callback: (id: string) => void) {
    const handler = (_: unknown, payload: { id: string }) => callback(payload.id);
    ipcRenderer.on('session:clear-terminal', handler);
    return () => ipcRenderer.removeListener('session:clear-terminal', handler);
  },
  onCopyTrimmed(callback: (id: string) => void) {
    const handler = (_: unknown, payload: { id: string }) => callback(payload.id);
    ipcRenderer.on('session:copy-trimmed', handler);
    return () => ipcRenderer.removeListener('session:copy-trimmed', handler);
  },
  onPaste(callback: (id: string) => void) {
    const handler = (_: unknown, payload: { id: string }) => callback(payload.id);
    ipcRenderer.on('session:paste', handler);
    return () => ipcRenderer.removeListener('session:paste', handler);
  },
  async startManaged(executorId: string): Promise<{ controllerId: string } | null> {
    return ipcRenderer.invoke('managed:start', { executorId });
  },
  stopManaged(executorId: string) {
    ipcRenderer.send('managed:stop', { executorId });
  },
  pauseManaged(executorId: string) {
    ipcRenderer.send('managed:pause', { executorId });
  },
  resumeManaged(executorId: string) {
    ipcRenderer.send('managed:resume', { executorId });
  },
  async isManagedAuto(executorId: string): Promise<boolean> {
    return ipcRenderer.invoke('managed:is-auto', { executorId });
  },
  onManagedPaused(callback: (payload: { pairId: string }) => void) {
    const handler = (_: unknown, payload: any) => callback(payload);
    ipcRenderer.on('managed:paused', handler);
    return () => ipcRenderer.removeListener('managed:paused', handler);
  },
  onManagedResumed(callback: (payload: { pairId: string }) => void) {
    const handler = (_: unknown, payload: any) => callback(payload);
    ipcRenderer.on('managed:resumed', handler);
    return () => ipcRenderer.removeListener('managed:resumed', handler);
  },
  onManagedAutoStarted(callback: (payload: { pairId: string }) => void) {
    const handler = (_: unknown, payload: any) => callback(payload);
    ipcRenderer.on('managed:auto-started', handler);
    return () => ipcRenderer.removeListener('managed:auto-started', handler);
  },
  async getManagedController(executorId: string): Promise<string | null> {
    return ipcRenderer.invoke('managed:get-controller', { executorId });
  },
  onManagedCreated(callback: (payload: { pairId: string; controllerId: string; executorId: string }) => void) {
    const handler = (_: unknown, payload: any) => callback(payload);
    ipcRenderer.on('managed:created', handler);
    return () => ipcRenderer.removeListener('managed:created', handler);
  },
  onManagedStopped(callback: (payload: { pairId: string; executorId: string }) => void) {
    const handler = (_: unknown, payload: any) => callback(payload);
    ipcRenderer.on('managed:stopped', handler);
    return () => ipcRenderer.removeListener('managed:stopped', handler);
  },
  onManagedCompleted(callback: (payload: { pairId: string }) => void) {
    const handler = (_: unknown, payload: any) => callback(payload);
    ipcRenderer.on('managed:completed', handler);
    return () => ipcRenderer.removeListener('managed:completed', handler);
  },
  onManagedTransfer(callback: (payload: { pairId: string; from: string; to: string }) => void) {
    const handler = (_: unknown, payload: any) => callback(payload);
    ipcRenderer.on('managed:transfer', handler);
    return () => ipcRenderer.removeListener('managed:transfer', handler);
  },
  onUsageUpdate(callback: (payload: { id: string; usage: any }) => void) {
    const handler = (_: unknown, payload: any) => callback(payload);
    ipcRenderer.on('session:usage', handler);
    return () => ipcRenderer.removeListener('session:usage', handler);
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
