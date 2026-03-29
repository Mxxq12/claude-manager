export type SessionStatus = 'created' | 'starting' | 'idle' | 'busy' | 'error' | 'closed';
export type IdleSubStatus = 'input' | 'approval';

export interface UsageInfo {
  percent?: number;
  type?: string;
  resetsAt?: string;
  warning?: boolean;
  limited?: boolean;
}

export interface SessionInfo {
  id: string;
  name: string;
  cwd: string;
  status: SessionStatus;
  idleSubStatus?: IdleSubStatus;
  statusTimestamp: number;
  createdAt: number;
  exitCode?: number;
  usage?: UsageInfo;
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
  createSession(cwd: string, resume?: boolean): void;
  sendInput(id: string, data: string): void;
  closeSession(id: string): void;
  renameSession(id: string, name: string): void;
  requestBuffer(id: string): Promise<Uint8Array[]>;
  resizePty(id: string, cols: number, rows: number): void;
  clearBuffer(id: string): void;
  saveClipboardImage(): Promise<string | null>;
  isDirectory(filePath: string): Promise<boolean>;
  selectDirectory(): Promise<string | null>;
  getRecentProjects(): Promise<{ path: string; name: string; mtime: number }[]>;
  removeRecentProject(projectPath: string): Promise<void>;
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
  openExternal(url: string): void;
  openPath(path: string): void;
  showSessionContextMenu(id: string, context?: string): void;
  confirmAndCreateSession(path: string): void;
  onSwitchTo(callback: (id: string) => void): () => void;
  onClearTerminal(callback: (id: string) => void): () => void;
  onCopyTrimmed(callback: (id: string) => void): () => void;
  onPaste(callback: (id: string) => void): () => void;
  onUsageUpdate(callback: (payload: { id: string; usage: UsageInfo }) => void): () => void;
  onRenameRequest?(callback: (id: string) => void): () => void;
  startManaged(executorId: string): Promise<{ controllerId: string } | null>;
  stopManaged(executorId: string): void;
  pauseManaged(executorId: string): void;
  resumeManaged(executorId: string): void;
  isManagedAuto(executorId: string): Promise<boolean>;
  getManagedController(executorId: string): Promise<string | null>;
  onManagedCreated(callback: (payload: { pairId: string; controllerId: string; executorId: string }) => void): () => void;
  onManagedStopped(callback: (payload: { pairId: string; executorId: string }) => void): () => void;
  onManagedPaused(callback: (payload: { pairId: string }) => void): () => void;
  onManagedResumed(callback: (payload: { pairId: string }) => void): () => void;
  onManagedAutoStarted(callback: (payload: { pairId: string }) => void): () => void;
  onManagedCompleted(callback: (payload: { pairId: string }) => void): () => void;
  onManagedTransfer(callback: (payload: { pairId: string; from: string; to: string }) => void): () => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
