import { useSessionStore } from '../stores/session-store';
import { SessionCard } from './SessionCard';

export function Sidebar() {
  const sessions = useSessionStore((s) => s.getSortedSessions());
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);

  const handleNewSession = async () => {
    const cwd = await window.electronAPI.selectDirectory();
    if (cwd) window.electronAPI.createSession(cwd);
  };

  const handleClose = (id: string) => {
    window.electronAPI.closeSession(id);
    useSessionStore.getState().removeSession(id);
  };

  const handleRename = (id: string, name: string) => {
    window.electronAPI.renameSession(id, name);
    useSessionStore.getState().renameSession(id, name);
  };

  return (
    <aside className="sidebar">
      <button className="new-session-btn" onClick={handleNewSession}>+ New Session</button>
      <div className="session-list">
        {sessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            onClick={() => setActiveSession(session.id)}
            onClose={() => handleClose(session.id)}
            onRename={(name) => handleRename(session.id, name)}
          />
        ))}
      </div>
    </aside>
  );
}
