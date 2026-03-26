import { useMemo, useEffect, useState, useRef, useCallback } from 'react';
import { useSessionStore } from '../stores/session-store';
import { SessionCard } from './SessionCard';
import { themes } from '../themes';

interface RecentProject {
  path: string;
  name: string;
}

interface Props {
  splitView: boolean;
  onToggleSplit: () => void;
  currentTheme: string;
  onThemeChange: (name: string) => void;
}

export function Sidebar({ splitView, onToggleSplit, currentTheme, onThemeChange }: Props) {
  const sessions = useSessionStore((s) => s.sessions);
  const sessionOrder = useSessionStore((s) => s.sessionOrder);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const reorderSession = useSessionStore((s) => s.reorderSession);
  const previousSessions = useSessionStore((s) => s.previousSessions);
  const clearPreviousSession = useSessionStore((s) => s.clearPreviousSession);
  const [dragSessionId, setDragSessionId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'before' | 'after'>('before');
  const [newlyIdle, setNewlyIdle] = useState<Set<string>>(new Set());
  const prevStatusRef = useRef<Map<string, string>>(new Map());
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [previousHeight, setPreviousHeight] = useState(() => {
    const saved = localStorage.getItem('claude-manager-previous-height');
    return saved ? parseInt(saved, 10) : 120;
  });
  const [recentHeight, setRecentHeight] = useState(() => {
    const saved = localStorage.getItem('claude-manager-recent-height');
    return saved ? parseInt(saved, 10) : 150;
  });
  const [draggingHandle, setDraggingHandle] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCounter = useRef(0);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const [autoApprove, setAutoApprove] = useState(false);

  useEffect(() => {
    if (window.electronAPI?.getAutoApproveGlobal) {
      window.electronAPI.getAutoApproveGlobal().then(setAutoApprove);
    }
  }, []);

  // Detect busy→idle transitions to mark "newly idle" sessions
  useEffect(() => {
    const prevMap = prevStatusRef.current;
    const newIdle = new Set(newlyIdle);
    for (const s of sessions) {
      const prev = prevMap.get(s.id);
      if ((prev === 'busy' || prev === 'starting') && s.status === 'idle') {
        newIdle.add(s.id);
      }
      prevMap.set(s.id, s.status);
    }
    if (newIdle.size !== newlyIdle.size) {
      setNewlyIdle(newIdle);
    }
  }, [sessions]);

  const handleSessionClick = (id: string) => {
    setActiveSession(id);
    // Clear "newly idle" mark when clicked
    if (newlyIdle.has(id)) {
      setNewlyIdle((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const makeHandleMouseDown = useCallback((target: 'previous' | 'recent') => (e: React.MouseEvent) => {
    e.preventDefault();
    setDraggingHandle(target);
    const startY = e.clientY;
    const startHeight = target === 'previous' ? previousHeight : recentHeight;
    const setter = target === 'previous' ? setPreviousHeight : setRecentHeight;

    const storageKey = target === 'previous' ? 'claude-manager-previous-height' : 'claude-manager-recent-height';
    const onMouseMove = (ev: MouseEvent) => {
      const delta = startY - ev.clientY;
      const newHeight = Math.max(40, Math.min(startHeight + delta, window.innerHeight - 250));
      setter(newHeight);
      localStorage.setItem(storageKey, String(newHeight));
    };
    const onMouseUp = () => {
      setDraggingHandle(null);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      dragCleanupRef.current = null;
    };
    // Store cleanup so it can be called on unmount
    dragCleanupRef.current = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [previousHeight, recentHeight]);

  // Cleanup drag listeners on unmount
  useEffect(() => {
    return () => {
      if (dragCleanupRef.current) {
        dragCleanupRef.current();
        dragCleanupRef.current = null;
      }
    };
  }, []);

  const sortedSessions = useMemo(() => {
    const orderMap = new Map(sessionOrder.map((cwd, i) => [cwd, i]));
    return [...sessions].sort((a, b) => {
      const aIdx = orderMap.get(a.cwd) ?? -1;
      const bIdx = orderMap.get(b.cwd) ?? -1;
      if (aIdx === -1 && bIdx === -1) return b.createdAt - a.createdAt;
      if (aIdx === -1) return -1;
      if (bIdx === -1) return 1;
      return aIdx - bIdx;
    });
  }, [sessions, sessionOrder]);

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
    window.electronAPI.closeSession(id);
    useSessionStore.getState().removeSession(id);
    window.electronAPI.createSession(cwd);
  };

  const isExternalDrag = (e: React.DragEvent) => {
    return e.dataTransfer.types.includes('Files') && !e.dataTransfer.types.includes('text/plain');
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isExternalDrag(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };
  const handleDragEnter = (e: React.DragEvent) => {
    if (!isExternalDrag(e)) return;
    e.preventDefault();
    dragCounter.current++;
    setDragOver(true);
  };
  const handleDragLeave = (e: React.DragEvent) => {
    if (!isExternalDrag(e)) return;
    dragCounter.current--;
    if (dragCounter.current === 0) setDragOver(false);
  };
  const handleDrop = (e: React.DragEvent) => {
    if (!isExternalDrag(e)) return;
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      const filePath = window.electronAPI.getPathForFile(files[i]);
      if (filePath) {
        window.electronAPI.confirmAndCreateSession(filePath);
      }
    }
  };

  return (
    <aside
      className={`sidebar ${dragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {dragOver && <div className="drop-overlay">拖放文件夹创建新会话</div>}
      <div className="sidebar-toolbar">
        <button className="toolbar-btn" onClick={handleNewSession}>+ 新建</button>
        {sessions.length >= 2 && (
          <>
            <span className="toolbar-divider" />
            <button
              className={`toolbar-btn ${splitView ? 'active' : ''}`}
              onClick={onToggleSplit}
              title={splitView ? '关闭分屏' : '开启分屏'}
            >
              {splitView ? '单屏' : '分屏'}
            </button>
          </>
        )}
      </div>
      <div className="session-list">
        {sortedSessions.map((session) => (
          <div
            key={session.id}
            draggable
            onDragStart={(e) => {
              setDragSessionId(session.id);
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('text/plain', session.id);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'move';
              if (dragSessionId && dragSessionId !== session.id) {
                const rect = e.currentTarget.getBoundingClientRect();
                const pos = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
                setDropTargetId(session.id);
                setDropPosition(pos);
              }
            }}
            onDragLeave={(e) => {
              e.stopPropagation();
              setDropTargetId((prev) => prev === session.id ? null : prev);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (dragSessionId && dragSessionId !== session.id) {
                reorderSession(dragSessionId, session.id, dropPosition);
              }
              setDragSessionId(null);
              setDropTargetId(null);
            }}
            onDragEnd={() => {
              setDragSessionId(null);
              setDropTargetId(null);
            }}
            className={`session-drag-wrapper ${dropTargetId === session.id ? (dropPosition === 'before' ? 'drag-insert-top' : 'drag-insert-bottom') : ''} ${dragSessionId === session.id ? 'dragging' : ''}`}
          >
            <SessionCard
              session={session}
              isActive={session.id === activeSessionId}
              isNewlyIdle={newlyIdle.has(session.id)}
              onClick={() => handleSessionClick(session.id)}
              onClose={() => handleClose(session.id)}
              onRename={(name) => handleRename(session.id, name)}
              onRestart={() => handleRestart(session.id)}
              onClearTerminal={() => window.dispatchEvent(new CustomEvent('clear-terminal', { detail: session.id }))}
            />
          </div>
        ))}
      </div>
      {previousSessions.length > 0 && (
        <>
          <div
            className={`sidebar-resize-handle ${draggingHandle === 'previous' ? 'dragging' : ''}`}
            onMouseDown={makeHandleMouseDown('previous')}
          />
          <div className="recent-projects previous-sessions-section" style={{ height: previousHeight, overflow: 'auto', flexShrink: 0 }}>
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
        </>
      )}
      {recentProjects.length > 0 && (
        <>
          <div
            className={`sidebar-resize-handle ${draggingHandle === 'recent' ? 'dragging' : ''}`}
            onMouseDown={makeHandleMouseDown('recent')}
          />
          <div className="recent-projects" style={{ height: recentHeight, overflow: 'auto', flexShrink: 0 }}>
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
        </>
      )}
      <div className="theme-selector">
        <span className="theme-label">主题</span>
        <select
          value={currentTheme}
          onChange={(e) => onThemeChange(e.target.value)}
        >
          {themes.map((t) => (
            <option key={t.name} value={t.name}>{t.label}</option>
          ))}
        </select>
      </div>
    </aside>
  );
}
