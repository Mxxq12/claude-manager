import { useMemo, useEffect, useState } from 'react';
import { useSessionStore } from '../stores/session-store';
import { SessionCard } from './SessionCard';
import type { SessionStatus } from '../types';

const statusOrder: Record<SessionStatus, number> = {
  idle: 0, error: 1, busy: 2, starting: 3, created: 4, closed: 5,
};

interface RecentProject {
  path: string;
  name: string;
}

export function Sidebar() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);

  const sortedSessions = useMemo(() =>
    [...sessions].sort((a, b) => {
      const diff = statusOrder[a.status] - statusOrder[b.status];
      if (diff !== 0) return diff;
      return b.statusTimestamp - a.statusTimestamp;
    }), [sessions]);

  useEffect(() => {
    if (window.electronAPI?.getRecentProjects) {
      window.electronAPI.getRecentProjects().then(setRecentProjects);
    }
  }, []);

  const handleNewSession = async () => {
    const cwd = await window.electronAPI.selectDirectory();
    if (cwd) window.electronAPI.createSession(cwd);
  };

  const handleOpenRecent = (projectPath: string) => {
    window.electronAPI.createSession(projectPath);
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
      <button className="new-session-btn" onClick={handleNewSession}>+ 新建会话</button>
      <div className="session-list">
        {sortedSessions.map((session) => (
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
      {recentProjects.length > 0 && (
        <div className="recent-projects">
          <div className="recent-projects-title">历史项目</div>
          <div className="recent-projects-list">
            {recentProjects.map((project) => (
              <div
                key={project.path}
                className="recent-project-item"
                onClick={() => handleOpenRecent(project.path)}
                title={project.path}
              >
                <span className="recent-project-name">{project.name}</span>
                <span className="recent-project-path">{project.path}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </aside>
  );
}
