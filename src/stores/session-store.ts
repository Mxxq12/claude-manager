import { create } from 'zustand';
import type { SessionInfo, SessionStatus, IdleSubStatus } from '../types';

interface SessionState {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  addSession: (id: string, name: string, cwd: string) => void;
  updateStatus: (id: string, status: SessionStatus, idleSubStatus?: IdleSubStatus, timestamp?: number) => void;
  removeSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  setActiveSession: (id: string) => void;
  getSortedSessions: () => SessionInfo[];
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  addSession: (id, name, cwd) =>
    set((state) => ({
      sessions: [...state.sessions, { id, name, cwd, status: 'idle', statusTimestamp: Date.now() }],
      activeSessionId: state.activeSessionId ?? id,
    })),
  updateStatus: (id, status, idleSubStatus, timestamp) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, status, idleSubStatus, statusTimestamp: timestamp ?? Date.now() } : s
      ),
    })),
  removeSession: (id) =>
    set((state) => {
      const remaining = state.sessions.filter((s) => s.id !== id);
      return {
        sessions: remaining,
        activeSessionId: state.activeSessionId === id ? (remaining[0]?.id ?? null) : state.activeSessionId,
      };
    }),
  renameSession: (id, name) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, name } : s)),
    })),
  setActiveSession: (id) => set({ activeSessionId: id }),
  getSortedSessions: () => {
    const { sessions } = get();
    return [...sessions].sort((a, b) => {
      const statusOrder: Record<SessionStatus, number> = {
        idle: 0, error: 1, busy: 2, starting: 3, created: 4, closed: 5,
      };
      const diff = statusOrder[a.status] - statusOrder[b.status];
      if (diff !== 0) return diff;
      return b.statusTimestamp - a.statusTimestamp;
    });
  },
}));
