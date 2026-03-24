import { useEffect, useState } from 'react';
import { Sidebar } from './components/Sidebar';
import { Terminal } from './components/Terminal';
import { StatusBar } from './components/StatusBar';
import { InputBar } from './components/InputBar';
import { useSessionStore } from './stores/session-store';
import type { SessionStatus } from './types';
import './App.css';

const statusOrder: Record<SessionStatus, number> = {
  idle: 0, error: 1, busy: 2, starting: 3, created: 4, closed: 5,
};

function getSorted() {
  const sessions = useSessionStore.getState().sessions;
  return [...sessions].sort((a, b) => {
    const diff = statusOrder[a.status] - statusOrder[b.status];
    if (diff !== 0) return diff;
    return b.statusTimestamp - a.statusTimestamp;
  });
}

export function App() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const [splitView, setSplitView] = useState(false);
  const [rightSessionId, setRightSessionId] = useState<string | null>(null);
  const rightSession = sessions.find((s) => s.id === rightSessionId) ?? null;

  const addSession = useSessionStore((s) => s.addSession);
  const updateStatus = useSessionStore((s) => s.updateStatus);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setExitCode = useSessionStore((s) => s.setExitCode);

  // Update window title when active session changes
  useEffect(() => {
    if (!window.electronAPI?.setWindowTitle) return;
    if (activeSession) {
      window.electronAPI.setWindowTitle(`${activeSession.name} - Claude Manager`);
    } else {
      window.electronAPI.setWindowTitle('Claude Manager');
    }
  }, [activeSession?.name, activeSessionId]);

  useEffect(() => {
    if (!window.electronAPI) return;
    const offCreated = window.electronAPI.onSessionCreated((p) => addSession(p.id, p.name, p.cwd));
    const offStatus = window.electronAPI.onSessionStatus((p) => updateStatus(p.id, p.status, p.idleSubStatus, p.timestamp));
    const offClosed = window.electronAPI.onSessionClosed((p) => {
      updateStatus(p.id, p.exitCode === 0 ? 'closed' : 'error', undefined, Date.now());
      setExitCode(p.id, p.exitCode);
    });
    return () => { offCreated(); offStatus(); offClosed(); };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!window.electronAPI) return;
      if (e.metaKey && e.key === 'n') {
        e.preventDefault();
        window.electronAPI.selectDirectory().then((cwd) => { if (cwd) window.electronAPI.createSession(cwd); });
      }
      if (e.metaKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const sorted = getSorted();
        const idx = parseInt(e.key) - 1;
        if (sorted[idx]) setActiveSession(sorted[idx].id);
      }
      if (e.metaKey && e.key === 'w') {
        e.preventDefault();
        if (activeSessionId) {
          window.electronAPI.closeSession(activeSessionId);
          useSessionStore.getState().removeSession(activeSessionId);
        }
      }
      if (e.metaKey && e.key === '[') {
        e.preventDefault();
        const sorted = getSorted();
        const idx = sorted.findIndex((s) => s.id === activeSessionId);
        if (idx > 0) setActiveSession(sorted[idx - 1].id);
      }
      if (e.metaKey && e.key === ']') {
        e.preventDefault();
        const sorted = getSorted();
        const idx = sorted.findIndex((s) => s.id === activeSessionId);
        if (idx < sorted.length - 1) setActiveSession(sorted[idx + 1].id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeSessionId]);

  // Clean up right pane session if it was removed
  useEffect(() => {
    if (rightSessionId && !sessions.find((s) => s.id === rightSessionId)) {
      setRightSessionId(null);
    }
  }, [sessions, rightSessionId]);

  return (
    <div className="app">
      <Sidebar
        splitView={splitView}
        onToggleSplit={() => setSplitView((v) => !v)}
      />
      <div className={`main-panels ${splitView ? 'split' : ''}`}>
        <main className="main-area">
          <Terminal sessionId={activeSessionId} />
          <InputBar sessionId={activeSessionId} />
          <StatusBar session={activeSession} />
        </main>
        {splitView && (
          <main className="main-area right-pane">
            <div className="right-pane-selector">
              <select
                className="right-pane-select"
                value={rightSessionId ?? ''}
                onChange={(e) => setRightSessionId(e.target.value || null)}
              >
                <option value="">-- 选择会话 --</option>
                {sessions.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <Terminal sessionId={rightSessionId} />
            <InputBar sessionId={rightSessionId} />
            <StatusBar session={rightSession} />
          </main>
        )}
      </div>
    </div>
  );
}
