import { useEffect } from 'react';
import { Sidebar } from './components/Sidebar';
import { Terminal } from './components/Terminal';
import { StatusBar } from './components/StatusBar';
import { useSessionStore } from './stores/session-store';
import './App.css';

export function App() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const addSession = useSessionStore((s) => s.addSession);
  const updateStatus = useSessionStore((s) => s.updateStatus);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);

  useEffect(() => {
    const offCreated = window.electronAPI.onSessionCreated((p) => addSession(p.id, p.name, p.cwd));
    const offStatus = window.electronAPI.onSessionStatus((p) => updateStatus(p.id, p.status, p.idleSubStatus, p.timestamp));
    const offClosed = window.electronAPI.onSessionClosed((p) => updateStatus(p.id, p.exitCode === 0 ? 'closed' : 'error', undefined, Date.now()));
    return () => { offCreated(); offStatus(); offClosed(); };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'n') {
        e.preventDefault();
        window.electronAPI.selectDirectory().then((cwd) => { if (cwd) window.electronAPI.createSession(cwd); });
      }
      if (e.metaKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const sorted = useSessionStore.getState().getSortedSessions();
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
        const sorted = useSessionStore.getState().getSortedSessions();
        const idx = sorted.findIndex((s) => s.id === activeSessionId);
        if (idx > 0) setActiveSession(sorted[idx - 1].id);
      }
      if (e.metaKey && e.key === ']') {
        e.preventDefault();
        const sorted = useSessionStore.getState().getSortedSessions();
        const idx = sorted.findIndex((s) => s.id === activeSessionId);
        if (idx < sorted.length - 1) setActiveSession(sorted[idx + 1].id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeSessionId]);

  return (
    <div className="app">
      <Sidebar />
      <main className="main-area">
        <Terminal sessionId={activeSessionId} />
        <StatusBar session={activeSession} />
      </main>
    </div>
  );
}
