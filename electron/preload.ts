import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../src/types';
import type { ElectronAPI } from '../src/types';

const api: ElectronAPI = {
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
  onSessionCreated(callback) {
    const handler = (_: unknown, payload: unknown) => callback(payload as any);
    ipcRenderer.on(IPC.SESSION_CREATED, handler);
    return () => ipcRenderer.removeListener(IPC.SESSION_CREATED, handler);
  },
  onSessionData(callback) {
    const handler = (_: unknown, payload: unknown) => callback(payload as any);
    ipcRenderer.on(IPC.SESSION_DATA, handler);
    return () => ipcRenderer.removeListener(IPC.SESSION_DATA, handler);
  },
  onSessionStatus(callback) {
    const handler = (_: unknown, payload: unknown) => callback(payload as any);
    ipcRenderer.on(IPC.SESSION_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC.SESSION_STATUS, handler);
  },
  onSessionClosed(callback) {
    const handler = (_: unknown, payload: unknown) => callback(payload as any);
    ipcRenderer.on(IPC.SESSION_CLOSED, handler);
    return () => ipcRenderer.removeListener(IPC.SESSION_CLOSED, handler);
  },
  onSessionBufferData(callback) {
    const handler = (_: unknown, payload: unknown) => callback(payload as any);
    ipcRenderer.on(IPC.SESSION_BUFFER_DATA, handler);
    return () => ipcRenderer.removeListener(IPC.SESSION_BUFFER_DATA, handler);
  },
};

contextBridge.exposeInMainWorld('electronAPI', api);
