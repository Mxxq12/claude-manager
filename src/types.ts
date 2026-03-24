export type SessionStatus = 'created' | 'starting' | 'idle' | 'busy' | 'error' | 'closed';
export type IdleSubStatus = 'input' | 'approval';

export interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  status: SessionStatus;
  idleSubStatus?: IdleSubStatus;
  statusTimestamp: number;
  createdAt: number;
  exitCode?: number;
}

export const IPC = {
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

export interface SessionCreatePayload {
  cwd: string;
}

export interface SessionCreatedPayload {
  id: string;
  name: string;
  cwd: string;
}

export interface SessionDataPayload {
  id: string;
  data: Uint8Array;
}

export interface SessionStatusPayload {
  id: string;
  status: SessionStatus;
  idleSubStatus?: IdleSubStatus;
  timestamp: number;
}

export interface SessionClosedPayload {
  id: string;
  exitCode: number;
}

export interface SessionInputPayload {
  id: string;
  data: string;
}

export interface SessionRenamePayload {
  id: string;
  name: string;
}

export interface SessionRequestBufferPayload {
  id: string;
}

export interface ElectronAPI {
  createSession(cwd: string): void;
  sendInput(id: string, data: string): void;
  closeSession(id: string): void;
  renameSession(id: string, name: string): void;
  requestBuffer(id: string): Promise<Uint8Array[]>;
  resizePty(id: string, cols: number, rows: number): void;
  selectDirectory(): Promise<string | null>;
  getRecentProjects(): Promise<{ path: string; name: string }[]>;
  setWindowTitle(title: string): void;
  getPathForFile(file: File): string;
  setAutoApproveGlobal(enabled: boolean): void;
  getAutoApproveGlobal(): Promise<boolean>;
  setAutoApproveSession(id: string, enabled: boolean): void;
  onSessionCreated(callback: (payload: SessionCreatedPayload) => void): () => void;
  onSessionData(callback: (payload: SessionDataPayload) => void): () => void;
  onSessionStatus(callback: (payload: SessionStatusPayload) => void): () => void;
  onSessionClosed(callback: (payload: SessionClosedPayload) => void): () => void;
  onSessionBufferData(callback: (payload: SessionDataPayload) => void): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
