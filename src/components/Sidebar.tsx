import { useMemo, useEffect, useState } from 'react';
import { useSessionStore } from '../stores/session-store';
import { SessionCard } from './SessionCard';
import { BatchCommandModal } from './BatchCommandModal';
import type { SessionStatus } from '../types';

const statusOrder: Record<SessionStatus, number> = {
  idle: 0, error: 1, busy: 2, starting: 3, created: 4, closed: 5,
};

interface RecentProject {
  path: string;
  name: string;
}

interface Props {
  splitView: boolean;
  onToggleSplit: () => void;
}

export function Sidebar({ splitView, onToggleSplit }: Props) {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const previousSessions = useSessionStore((s) => s.previousSessions);
  const clearPreviousSession = useSessionStore((s) => s.clearPreviousSession);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showBatchModal, setShowBatchModal] = useState(false);

  const sortedSessions = useMemo(() =>
    [...sessions].sort((a, b) => {
      const diff = statusOrder[a.status] - statusOrder[b.status];
      if (diff !== 0) return diff;
      return b.statusTimestamp - a.statusTimestamp;
    }), [sessions]);

  // Status summary counts
  const statusCounts = useMemo(() => {
    let idle = 0, busy = 0, error = 0;
    for (const s of sessions) {
      if (s.status === 'idle') idle++;
      else if (s.status === 'busy' || s.status === 'starting') busy++;
      else if (s.status === 'error') error++;
    }
    return { idle, busy, error };
  }, [sessions]);

  useEffect(() => {
    if (window.electronAPI?.getRecentProjects) {
      window.electronAPI.getRecentProjects().then(setRecentProjects);
    }
  }, []);

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return recentProjects;
    const q = searchQuery.toLowerCase();
    return recentProjects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
    );
  }, [recentProjects, searchQuery]);

  const handleNewSession = async () => {
    const cwd = await window.electronAPI.selectDirectory();
    if (cwd) window.electronAPI.createSession(cwd);
  };

  const handleOpenRecent = (projectPath: string) => {
    window.electronAPI.createSession(projectPath);
  };

  const handleOpenPrevious = (cwd: string) => {
    window.electronAPI.createSession(cwd);
    clearPreviousSession(cwd);
  };

  const handleClose = (id: string) => {
    window.electronAPI.closeSession(id);
    useSessionStore.getState().removeSession(id);
  };

  const handleRename = (id: string, name: string) => {
    window.electronAPI.renameSession(id, name);
    useSessionStore.getState().renameSession(id, name);
  };

  const handleRestart = (id: string) => {
    const session = sessions.find((s) => s.id === id);
    if (!session) return;
    const cwd = session.cwd;
    // Remove the errored session
    window.electronAPI.closeSession(id);
    useSessionStore.getState().removeSession(id);
    // Create a new session in the same directory
    window.electronAPI.createSession(cwd);
  };

  return (
    <aside className="sidebar">
      {/* Status summary */}
      {sessions.length > 0 && (
        <div className="status-summary">
          <span title="空闲">🟢 {statusCounts.idle}</span>
          <span title="忙碌">🔵 {statusCounts.busy}</span>
          <span title="错误">🔴 {statusCounts.error}</span>
        </div>
      )}
      <div className="sidebar-buttons">
        <button className="new-session-btn" onClick={handleNewSession}>+ 新建会话</button>
        <button
          className={`split-btn ${splitView ? 'active' : ''}`}
          onClick={onToggleSplit}
          title={splitView ? '关闭分屏' : '开启分屏'}
        >
          分屏
        </button>
      </div>
      <button
        className="batch-btn"
        onClick={() => setShowBatchModal(true)}
        disabled={sessions.filter((s) => s.status !== 'closed').length === 0}
      >
        批量指令
      </button>
      <div className="session-list">
        {sortedSessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            isActive={session.id === activeSessionId}
            onClick={() => setActiveSession(session.id)}
            onClose={() => handleClose(session.id)}
            onRename={(name) => handleRename(session.id, name)}
            onRestart={() => handleRestart(session.id)}
          />
        ))}
      </div>
      {/* Previous sessions from localStorage */}
      {previousSessions.length > 0 && (
        <div className="recent-projects previous-sessions-section">
          <div className="recent-projects-title">上次的会话</div>
          <div className="recent-projects-list">
            {previousSessions.map((s) => (
              <div
                key={s.cwd}
                className="recent-project-item"
                onClick={() => handleOpenPrevious(s.cwd)}
                title={s.cwd}
              >
                <span className="recent-project-name">{s.name}</span>
                <span className="recent-project-path">{s.cwd}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {recentProjects.length > 0 && (
        <div className="recent-projects">
          <div className="recent-projects-title">历史项目</div>
          <div className="recent-search-wrapper">
            <input
              className="recent-search-input"
              type="text"
              placeholder="搜索项目..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <div className="recent-projects-list">
            {filteredProjects.map((project) => (
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
            {filteredProjects.length === 0 && searchQuery && (
              <div className="recent-search-empty">无匹配项目</div>
            )}
          </div>
        </div>
      )}
      {showBatchModal && (
        <BatchCommandModal
          sessions={sessions}
          onClose={() => setShowBatchModal(false)}
        />
      )}
    </aside>
  );
}
