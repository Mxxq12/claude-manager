import { useMemo, useEffect, useState, useRef, useCallback } from 'react';
import { useSessionStore } from '../stores/session-store';
import { SessionCard } from './SessionCard';
import { themes } from '../themes';

interface RecentProject {
  path: string;
  name: string;
  mtime: number;
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
  const [managedSessions, setManagedSessions] = useState<Set<string>>(new Set());
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchVisible, setSearchVisible] = useState(false);
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

  const handleToggleManaged = async (sessionId: string) => {
    if (managedSessions.has(sessionId)) {
      window.electronAPI.stopManaged(sessionId);
      setManagedSessions((prev) => { const next = new Set(prev); next.delete(sessionId); return next; });
    } else {
      const result = await window.electronAPI.startManaged(sessionId);
      if (result) {
        setManagedSessions((prev) => new Set(prev).add(sessionId));
      }
    }
  };

  // Listen for managed stopped events (e.g. when session is closed)
  useEffect(() => {
    const offStopped = window.electronAPI.onManagedStopped?.((payload) => {
      setManagedSessions((prev) => { const next = new Set(prev); next.delete(payload.executorId); return next; });
    });
    return () => { offStopped?.(); };
  }, []);

  useEffect(() => {
    if (window.electronAPI?.getAutoApproveGlobal) {
      window.electronAPI.getAutoApproveGlobal().then(setAutoApprove);
    }
  }, []);

  // Detect busy→idle transitions to mark "newly idle" sessions
  // Clear mark when session is no longer idle
  useEffect(() => {
    const prevMap = prevStatusRef.current;
    const newIdle = new Set(newlyIdle);
    let changed = false;
    for (const s of sessions) {
      const prev = prevMap.get(s.id);
      if ((prev === 'busy' || prev === 'starting') && s.status === 'idle') {
        newIdle.add(s.id);
        changed = true;
      }
      // Remove mark if session is no longer idle
      if (s.status !== 'idle' && newIdle.has(s.id)) {
        newIdle.delete(s.id);
        changed = true;
      }
      prevMap.set(s.id, s.status);
    }
    if (changed) {
      setNewlyIdle(newIdle);
    }
  }, [sessions]);

  // Clear "newly idle" mark when user types in terminal
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent).detail;
      if (newlyIdle.has(id)) {
        setNewlyIdle((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    };
    window.addEventListener('session-user-input', handler);
    return () => window.removeEventListener('session-user-input', handler);
  }, [newlyIdle]);

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

  // Merge previousSessions and recentProjects into one list, deduplicated by path, sorted by mtime
  const mergedProjects = useMemo(() => {
    const activeCwds = new Set(sessions.map((s) => s.cwd));
    const map = new Map<string, RecentProject>();
    // Previous sessions get current timestamp (most recent)
    for (const s of previousSessions) {
      if (!activeCwds.has(s.cwd)) {
        map.set(s.cwd, { path: s.cwd, name: s.name, mtime: Date.now() });
      }
    }
    // Recent projects fill in the rest
    for (const p of recentProjects) {
      if (!activeCwds.has(p.path) && !map.has(p.path)) {
        map.set(p.path, p);
      }
    }
    return [...map.values()].sort((a, b) => b.mtime - a.mtime);
  }, [recentProjects, previousSessions, sessions]);

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return mergedProjects;
    const q = searchQuery.toLowerCase();
    return mergedProjects.filter(
      (p) => p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q)
    );
  }, [mergedProjects, searchQuery]);

  const handleNewSession = async () => {
    const cwd = await window.electronAPI.selectDirectory();
    if (cwd) window.electronAPI.createSession(cwd);
  };

  const [resumeDialog, setResumeDialog] = useState<{ path: string; name: string } | null>(null);

  const handleOpenRecent = (projectPath: string) => {
    setResumeDialog({ path: projectPath, name: projectPath.split('/').pop() || projectPath });
  };

  const handleResumeChoice = (resume: boolean) => {
    if (!resumeDialog) return;
    window.electronAPI.createSession(resumeDialog.path, resume);
    clearPreviousSession(resumeDialog.path);
    setResumeDialog(null);
  };

  const handleRemoveRecent = async (e: React.MouseEvent, projectPath: string) => {
    e.stopPropagation();
    await window.electronAPI.removeRecentProject(projectPath);
    setRecentProjects((prev) => prev.filter((p) => p.path !== projectPath));
    clearPreviousSession(projectPath);
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
    window.electronAPI.createSession(cwd, true);
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
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setDragOver(false);
    }
  };
  const handleDragEnd = () => {
    dragCounter.current = 0;
    setDragOver(false);
  };
  const handleDrop = async (e: React.DragEvent) => {
    if (!isExternalDrag(e)) return;
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      const filePath = window.electronAPI.getPathForFile(files[i]);
      if (!filePath) continue;
      const isDir = await window.electronAPI.isDirectory(filePath);
      if (isDir) {
        window.electronAPI.confirmAndCreateSession(filePath);
      } else if (activeSessionId) {
        window.electronAPI.sendInput(activeSessionId, filePath);
      }
    }
  };

  return (
    <aside
      className={`sidebar ${dragOver ? 'drag-over' : ''}`}
      onDragOver={handleDragOver}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragEnd={handleDragEnd}
      onDrop={handleDrop}
    >
      {dragOver && <div className="drop-overlay">文件夹 → 新建会话 | 文件 → 插入路径</div>}
      <div className="sidebar-toolbar">
        <button className="toolbar-btn" onClick={handleNewSession}>+ 新建 / 打开</button>
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
              isManaged={managedSessions.has(session.id)}
              onToggleManaged={() => handleToggleManaged(session.id)}
              onClick={() => handleSessionClick(session.id)}
              onClose={() => handleClose(session.id)}
              onRename={(name) => handleRename(session.id, name)}
              onRestart={() => handleRestart(session.id)}
              onClearTerminal={() => window.dispatchEvent(new CustomEvent('clear-terminal', { detail: session.id }))}
            />
          </div>
        ))}
      </div>
      {mergedProjects.length > 0 && (
        <>
          <div
            className={`sidebar-resize-handle ${draggingHandle === 'recent' ? 'dragging' : ''}`}
            onMouseDown={makeHandleMouseDown('recent')}
          />
          <div className="recent-projects" style={{ height: recentHeight, overflow: 'auto', flexShrink: 0 }}>
            <div className="recent-projects-title">
              历史项目
              <button
                className="recent-search-toggle"
                onClick={() => { setSearchVisible((v) => !v); if (searchQuery) setSearchQuery(''); }}
                title="搜索项目"
              >🔍</button>
            </div>
            {searchVisible && (
              <div className="recent-search-wrapper">
                <input
                  className="recent-search-input"
                  type="text"
                  placeholder="搜索项目..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  autoFocus
                />
              </div>
            )}
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
                  <button
                    className="recent-project-remove"
                    onClick={(e) => handleRemoveRecent(e, project.path)}
                    title="隐藏此项目"
                  >×</button>
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
      {resumeDialog && (
        <div className="resume-dialog-overlay" onClick={() => setResumeDialog(null)}>
          <div className="resume-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="resume-dialog-title">{resumeDialog.name}</div>
            <div className="resume-dialog-path">{resumeDialog.path}</div>
            <div className="resume-dialog-buttons">
              <button className="resume-dialog-btn resume" onClick={() => handleResumeChoice(true)}>恢复会话</button>
              <button className="resume-dialog-btn new" onClick={() => handleResumeChoice(false)}>新会话</button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
