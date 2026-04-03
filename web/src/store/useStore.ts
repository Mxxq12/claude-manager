import { create } from 'zustand';

export interface Session {
  id: string;
  name: string;
  status: 'idle' | 'busy' | 'error' | 'closed';
  idleSubStatus?: 'input' | 'approval';
  cwd: string;
  statusTimestamp?: number;
}

export interface Toast {
  id: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
}

interface AppState {
  token: string | null;
  sessions: Map<string, Session>;
  wsConnected: boolean;
  autoApproveSessions: Set<string>;
  managedSessions: Map<string, string>; // executorId -> controllerId
  toasts: Toast[];

  setToken: (token: string | null) => void;
  setWsConnected: (connected: boolean) => void;
  setSessions: (list: Session[]) => void;
  addSession: (session: Session) => void;
  updateStatus: (id: string, status: Session['status'], idleSubStatus?: Session['idleSubStatus']) => void;
  updateSession: (id: string, partial: Partial<Session>) => void;
  removeSession: (id: string) => void;
  setAutoApprove: (id: string, enabled: boolean) => void;
  setManaged: (executorId: string, controllerId: string | null) => void;
  addToast: (message: string, type?: Toast['type']) => void;
  removeToast: (id: string) => void;
}

const savedToken = localStorage.getItem('token');

let toastCounter = 0;

export const useStore = create<AppState>((set) => ({
  token: savedToken,
  sessions: new Map(),
  wsConnected: false,
  autoApproveSessions: new Set(),
  managedSessions: new Map(),
  toasts: [],

  setToken: (token) => {
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
    set({ token });
  },

  setWsConnected: (connected) => set({ wsConnected: connected }),

  setSessions: (list) => {
    const map = new Map<string, Session>();
    for (const s of list) {
      map.set(s.id, s);
    }
    set({ sessions: map });
  },

  addSession: (session) =>
    set((state) => {
      const next = new Map(state.sessions);
      next.set(session.id, session);
      return { sessions: next };
    }),

  updateStatus: (id, status, idleSubStatus) =>
    set((state) => {
      const prev = state.sessions.get(id);
      if (!prev) return state;
      const next = new Map(state.sessions);
      next.set(id, { ...prev, status, idleSubStatus });
      return { sessions: next };
    }),

  updateSession: (id, partial) =>
    set((state) => {
      const prev = state.sessions.get(id);
      if (!prev) return state;
      const next = new Map(state.sessions);
      next.set(id, { ...prev, ...partial });
      return { sessions: next };
    }),

  removeSession: (id) =>
    set((state) => {
      const next = new Map(state.sessions);
      next.delete(id);
      return { sessions: next };
    }),

  setAutoApprove: (id, enabled) =>
    set((state) => {
      const next = new Set(state.autoApproveSessions);
      if (enabled) next.add(id); else next.delete(id);
      return { autoApproveSessions: next };
    }),

  setManaged: (executorId, controllerId) =>
    set((state) => {
      const next = new Map(state.managedSessions);
      if (controllerId) next.set(executorId, controllerId); else next.delete(executorId);
      return { managedSessions: next };
    }),

  addToast: (message, type = 'info') =>
    set((state) => {
      const id = `toast-${++toastCounter}-${Date.now()}`;
      const toast: Toast = { id, message, type };
      setTimeout(() => {
        useStore.getState().removeToast(id);
      }, 3000);
      return { toasts: [...state.toasts, toast] };
    }),

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),
}));
