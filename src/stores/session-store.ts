import { create } from 'zustand';
import type { SessionInfo, SessionStatus, IdleSubStatus } from '../types';

const PERSISTED_SESSIONS_KEY = 'claude-manager-session-cwds';
const CUSTOM_NAMES_KEY = 'claude-manager-custom-names';
const SESSION_ORDER_KEY = 'claude-manager-session-order';

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
      if (s.cwd.endsWith('/.managed')) return false; // Skip managed controller sessions
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
    .filter((s) => !s.cwd.endsWith('/.managed'))
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

// Session order is persisted by cwd (stable across restarts)
function loadSessionOrder(): string[] {
  try {
    const raw = localStorage.getItem(SESSION_ORDER_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveSessionOrder(order: string[]) {
  localStorage.setItem(SESSION_ORDER_KEY, JSON.stringify(order));
}

interface SessionState {
  sessions: SessionInfo[];
  activeSessionId: string | null;
  previousSessions: { cwd: string; name: string }[];
  sessionOrder: string[];
  addSession: (id: string, name: string, cwd: string) => void;
  updateStatus: (id: string, status: SessionStatus, idleSubStatus?: IdleSubStatus, timestamp?: number) => void;
  removeSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  setActiveSession: (id: string) => void;
  setExitCode: (id: string, exitCode: number) => void;
  updateUsage: (id: string, usage: SessionInfo['usage']) => void;
  getSortedSessions: () => SessionInfo[];
  reorderSession: (fromId: string, toId: string, position?: 'before' | 'after') => void;
  clearPreviousSession: (cwd: string) => void;
  clearAllPreviousSessions: () => void;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  sessions: [],
  activeSessionId: null,
  previousSessions: loadPersistedSessions(),
  sessionOrder: loadSessionOrder(),
  addSession: (id, name, cwd) =>
    set((state) => {
      const now = Date.now();
      const customName = getCustomName(cwd) || name;
      const newSessions = [...state.sessions, { id, name: customName, cwd, status: 'idle' as SessionStatus, statusTimestamp: now, createdAt: now }];
      persistSessions(newSessions);
      // New session goes to top of order (by cwd)
      const newOrder = state.sessionOrder.includes(cwd)
        ? state.sessionOrder
        : [cwd, ...state.sessionOrder];
      saveSessionOrder(newOrder);
      // Remove from previousSessions if it matches this cwd
      const newPrev = state.previousSessions.filter((s) => s.cwd !== cwd);
      return {
        sessions: newSessions,
        activeSessionId: id,
        previousSessions: newPrev,
        sessionOrder: newOrder,
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
      const cwdToRemove = session?.cwd;
      const newOrder = cwdToRemove
        ? state.sessionOrder.filter((c) => c !== cwdToRemove)
        : state.sessionOrder;
      saveSessionOrder(newOrder);
      // Add closed session to previousSessions so user can reopen it
      const newPrev = session && !session.cwd.endsWith('/.managed')
        ? [...state.previousSessions.filter((s) => s.cwd !== session.cwd), { cwd: session.cwd, name: session.name }]
        : state.previousSessions;
      return {
        sessions: remaining,
        sessionOrder: newOrder,
        previousSessions: newPrev,
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
  updateUsage: (id, usage) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === id ? { ...s, usage } : s
      ),
    })),
  getSortedSessions: () => {
    const { sessions, sessionOrder } = get();
    const orderMap = new Map(sessionOrder.map((cwd, i) => [cwd, i]));
    return [...sessions].sort((a, b) => {
      const aIdx = orderMap.get(a.cwd) ?? -1;
      const bIdx = orderMap.get(b.cwd) ?? -1;
      if (aIdx === -1 && bIdx === -1) return b.createdAt - a.createdAt;
      if (aIdx === -1) return -1;
      if (bIdx === -1) return 1;
      return aIdx - bIdx;
    });
  },
  reorderSession: (fromId, toId, position = 'before') =>
    set((state) => {
      const { sessions, sessionOrder } = state;
      const fromSession = sessions.find((s) => s.id === fromId);
      const toSession = sessions.find((s) => s.id === toId);
      if (!fromSession || !toSession) return {};
      const fromCwd = fromSession.cwd;
      const toCwd = toSession.cwd;
      // Build current effective order by cwd
      const orderMap = new Map(sessionOrder.map((cwd, i) => [cwd, i]));
      const ordered = [...sessions].sort((a, b) => {
        const aIdx = orderMap.get(a.cwd) ?? -1;
        const bIdx = orderMap.get(b.cwd) ?? -1;
        if (aIdx === -1 && bIdx === -1) return b.createdAt - a.createdAt;
        if (aIdx === -1) return -1;
        if (bIdx === -1) return 1;
        return aIdx - bIdx;
      });
      const cwds = ordered.map((s) => s.cwd);
      const fromIndex = cwds.indexOf(fromCwd);
      if (fromIndex === -1) return {};
      cwds.splice(fromIndex, 1);
      const toIndex = cwds.indexOf(toCwd);
      if (toIndex === -1) return {};
      const insertAt = position === 'after' ? toIndex + 1 : toIndex;
      cwds.splice(insertAt, 0, fromCwd);
      saveSessionOrder(cwds);
      return { sessionOrder: cwds };
    }),
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
