import { create } from 'zustand';
import type { SessionInfo, SessionStatus, IdleSubStatus } from '../types';

const PERSISTED_SESSIONS_KEY = 'claude-manager-session-cwds';
const CUSTOM_NAMES_KEY = 'claude-manager-custom-names';

function loadCustomNames(): Record<string, string> {
  try {
    const raw = localStorage.getItem(CUSTOM_NAMES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveCustomName(cwd: string, name: string) {
  const names = loadCustomNames();
  names[cwd] = name;
  localStorage.setItem(CUSTOM_NAMES_KEY, JSON.stringify(names));
}

function getCustomName(cwd: string): string | null {
  return loadCustomNames()[cwd] || null;
}

function loadPersistedSessions(): { cwd: string; name: string }[] {
  try {
    const raw = localStorage.getItem(PERSISTED_SESSIONS_KEY);
    const list: { cwd: string; name: string }[] = raw ? JSON.parse(raw) : [];
    const customNames = loadCustomNames();
    const seen = new Set<string>();
    return list.filter((s) => {
      if (seen.has(s.cwd)) return false;
      seen.add(s.cwd);
      return true;
    }).map((s) => ({
      ...s,
      name: customNames[s.cwd] || s.name,
    }));
  } catch {
    return [];
  }
}

function persistSessions(sessions: SessionInfo[]) {
  const seen = new Set<string>();
  const data = sessions
    .filter((s) => s.status !== 'closed')
    .filter((s) => {
      if (seen.has(s.cwd)) return false;
      seen.add(s.cwd);
      return true;
    })
    .map((s) => ({ cwd: s.cwd, name: s.name }));
  localStorage.setItem(PERSISTED_SESSIONS_KEY, JSON.stringify(data));
}

function clearPersistedSession(cwd: string) {
  const current = loadPersistedSessions();
  const updated = current.filter((s) => s.cwd !== cwd);
  localStorage.setItem(PERSISTED_SESSIONS_KEY, JSON.stringify(updated));
}

interface SessionState {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  previousSessions: { cwd: string; name: string }[];
  addSession: (id: string, name: string, cwd: string) => void;
  updateStatus: (id: string, status: SessionStatus, idleSubStatus?: IdleSubStatus, timestamp?: number) => void;
  removeSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  setActiveSession: (id: string) => void;
  setExitCode: (id: string, exitCode: number) => void;
  getSortedSessions: () => SessionInfo[];
  clearPreviousSession: (cwd: string) => void;
  clearAllPreviousSessions: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  previousSessions: loadPersistedSessions(),
  addSession: (id, name, cwd) =>
    set((state) => {
      const now = Date.now();
      const customName = getCustomName(cwd) || name;
      const newSessions = [...state.sessions, { id, name: customName, cwd, status: 'idle' as SessionStatus, statusTimestamp: now, createdAt: now }];
      persistSessions(newSessions);
      // Remove from previousSessions if it matches this cwd
      const newPrev = state.previousSessions.filter((s) => s.cwd !== cwd);
      return {
        sessions: newSessions,
        activeSessionId: id,
        previousSessions: newPrev,
      };
    }),
  updateStatus: (id, status, idleSubStatus, timestamp) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, status, idleSubStatus, statusTimestamp: timestamp ?? Date.now() } : s
      ),
    })),
  removeSession: (id) =>
    set((state) => {
      const session = state.sessions.find((s) => s.id === id);
      if (session) {
        clearPersistedSession(session.cwd);
      }
      const remaining = state.sessions.filter((s) => s.id !== id);
      persistSessions(remaining);
      return {
        sessions: remaining,
        activeSessionId: state.activeSessionId === id ? (remaining[0]?.id ?? null) : state.activeSessionId,
      };
    }),
  renameSession: (id, name) =>
    set((state) => {
      const session = state.sessions.find((s) => s.id === id);
      if (session) saveCustomName(session.cwd, name);
      return {
        sessions: state.sessions.map((s) => (s.id === id ? { ...s, name } : s)),
      };
    }),
  setActiveSession: (id) => set({ activeSessionId: id }),
  setExitCode: (id, exitCode) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, exitCode } : s
      ),
    })),
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
  clearPreviousSession: (cwd) =>
    set((state) => {
      clearPersistedSession(cwd);
      return { previousSessions: state.previousSessions.filter((s) => s.cwd !== cwd) };
    }),
  clearAllPreviousSessions: () => {
    localStorage.removeItem(PERSISTED_SESSIONS_KEY);
    set({ previousSessions: [] });
  },
}));
