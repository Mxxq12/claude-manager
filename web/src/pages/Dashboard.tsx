import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { wsSend } from '../hooks/useWebSocket';
import type { Session } from '../store/useStore';

const STATUS_LABEL: Record<string, string> = {
  idle: '空闲',
  busy: '运行中',
  approval: '待审批',
  error: '错误',
  closed: '已关闭',
};

function formatTime(ts: number | string | undefined) {
  if (!ts || ts === 0) return '';
  try {
    const d = new Date(ts);
    if (d.getFullYear() < 2020) return '';
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

function formatDuration(ts: number | string | undefined) {
  if (!ts) return '';
  const now = Date.now();
  const start = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const diff = Math.max(0, now - start);
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}天${hours % 24}小时`;
  if (hours > 0) return `${hours}小时${minutes % 60}分`;
  return `${minutes}分钟`;
}

function shortenCwd(cwd: string) {
  if (!cwd) return '';
  const shortened = cwd.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~');
  return shortened;
}

// Swipeable session card
function SwipeCard({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const startXRef = useRef(0);
  const currentXRef = useRef(0);
  const swipingRef = useRef(false);

  const handleTouchStart = (e: React.TouchEvent) => {
    startXRef.current = e.touches[0].clientX;
    currentXRef.current = 0;
    swipingRef.current = false;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const dx = e.touches[0].clientX - startXRef.current;
    if (dx < -10) {
      swipingRef.current = true;
      currentXRef.current = Math.max(dx, -120);
      if (ref.current) {
        ref.current.style.transform = `translateX(${currentXRef.current}px)`;
        ref.current.style.transition = 'none';
      }
    }
  };

  const handleTouchEnd = () => {
    if (!ref.current) return;
    ref.current.style.transition = 'transform 0.25s ease';
    if (currentXRef.current < -80) {
      // Auto-delete
      ref.current.style.transform = 'translateX(-100%)';
      setTimeout(onDelete, 250);
    } else {
      ref.current.style.transform = 'translateX(0)';
    }
    currentXRef.current = 0;
    swipingRef.current = false;
  };

  return (
    <div className="swipe-card-wrapper">
      <div className="swipe-card-bg">
        <span>删除</span>
      </div>
      <div
        ref={ref}
        className="swipe-card-content"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {children}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const navigate = useNavigate();
  const token = useStore((s) => s.token);
  const sessions = useStore((s) => s.sessions);
  const wsConnected = useStore((s) => s.wsConnected);
  const setToken = useStore((s) => s.setToken);
  const autoApproveSessions = useStore((s) => s.autoApproveSessions);
  const managedSessions = useStore((s) => s.managedSessions);
  const addToast = useStore((s) => s.addToast);
  const [showModal, setShowModal] = useState(false);
  const [baseDir, setBaseDir] = useState(() => localStorage.getItem('lastBaseDir') || '/Users/jabi/Documents/claude');
  const [projectName, setProjectName] = useState('');
  const [creating, setCreating] = useState(false);
  const [projects, setProjects] = useState<{ path: string; name: string }[]>([]);
  const [modalTab, setModalTab] = useState<'open' | 'new'>('open');
  const [notificationEnabled, setNotificationEnabled] = useState(() => typeof Notification !== 'undefined' && Notification.permission === 'granted');

  // Pull-to-refresh state
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullStartY = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);

  const fetchSessions = useCallback(() => {
    if (!token) return;
    return fetch('/api/sessions', {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (r.status === 401) {
          setToken(null);
          navigate('/login', { replace: true });
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data && Array.isArray(data)) {
          useStore.getState().setSessions(data);
        }
      })
      .catch(() => {});
  }, [token, navigate, setToken]);

  // 初始加载会话列表（HTTP 兜底）
  useEffect(() => {
    fetchSessions();
  }, [fetchSessions]);

  const sessionList: Session[] = Array.from(sessions.values()).sort(
    (a, b) => (b.statusTimestamp || 0) - (a.statusTimestamp || 0),
  );

  const handleOpenProject = async (projectPath: string) => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cwd: projectPath, resume: true }),
      });
      if (res.ok) {
        const session = await res.json();
        useStore.getState().addSession(session);
        addToast('会话已创建', 'success');
        setShowModal(false);
        navigate(`/session/${session.id}`);
      }
    } catch {} finally { setCreating(false); }
  };

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cwd: projectName.trim() ? `${baseDir.replace(/\/+$/, '')}/${projectName.trim()}` : baseDir }),
      });
      if (res.ok) {
        const session = await res.json();
        useStore.getState().addSession(session);
        addToast('会话已创建', 'success');
        localStorage.setItem('lastBaseDir', baseDir);
        setShowModal(false);
        navigate(`/session/${session.id}`);
      }
    } catch {
      // ignore
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string, skipConfirm = false) => {
    if (!skipConfirm && !confirm('确定终止该会话？')) return;
    try {
      await fetch(`/api/sessions/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      useStore.getState().removeSession(id);
      addToast('会话已删除', 'info');
    } catch {
      // ignore
    }
  };

  const handleDeleteClick = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    handleDelete(id);
  };

  const handleLogout = () => {
    setToken(null);
    navigate('/login', { replace: true });
  };

  const getStatusClass = (s: Session) => {
    if (s.idleSubStatus === 'approval') return 'approval';
    return s.status;
  };

  // Pull-to-refresh handlers
  const handlePullTouchStart = (e: React.TouchEvent) => {
    if (listRef.current && listRef.current.scrollTop === 0) {
      pullStartY.current = e.touches[0].clientY;
    } else {
      pullStartY.current = 0;
    }
  };

  const handlePullTouchMove = (e: React.TouchEvent) => {
    if (pullStartY.current === 0 || refreshing) return;
    const dy = e.touches[0].clientY - pullStartY.current;
    if (dy > 0) {
      setPullDistance(Math.min(dy * 0.5, 80));
    }
  };

  const handlePullTouchEnd = () => {
    if (pullDistance > 50 && !refreshing) {
      setRefreshing(true);
      setPullDistance(50);
      fetchSessions()?.finally(() => {
        setRefreshing(false);
        setPullDistance(0);
        addToast('已刷新', 'success');
      });
    } else {
      setPullDistance(0);
    }
  };

  // Request notification permission
  const handleEnableNotification = async () => {
    if (!('Notification' in window)) {
      addToast('当前浏览器不支持通知', 'warning');
      return;
    }
    const result = await Notification.requestPermission();
    if (result === 'granted') {
      setNotificationEnabled(true);
      addToast('通知已开启', 'success');
    } else {
      addToast('通知权限被拒绝', 'warning');
    }
  };

  // Skeleton screen
  const showSkeleton = sessionList.length === 0 && !wsConnected;

  return (
    <div className="page dashboard-page">
      <div className="dashboard-header">
        <div className="dashboard-header-left">
          <h1>Claude Manager</h1>
        </div>
        <div className="dashboard-header-right">
          {!notificationEnabled && (
            <button className="btn-logout" onClick={handleEnableNotification} title="开启通知">
              🔔
            </button>
          )}
          <div className="ws-status">
            <div className={`ws-indicator ${wsConnected ? 'connected' : ''}`} />
            <span>{wsConnected ? '已连接' : '未连接'}</span>
          </div>
          <button className="btn-logout" onClick={handleLogout}>
            登出
          </button>
        </div>
      </div>

      {showSkeleton ? (
        <div className="session-list">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton-card">
              <div className="skeleton-stripe" />
              <div className="skeleton-body">
                <div className="skeleton-dot" />
                <div className="skeleton-info">
                  <div className="skeleton-line skeleton-line-title" />
                  <div className="skeleton-line skeleton-line-sub" />
                  <div className="skeleton-line skeleton-line-meta" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : sessionList.length === 0 ? (
        <div className="dashboard-empty">
          <div className="empty-icon">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" strokeLinecap="round" strokeLinejoin="round"/>
              <rect x="9" y="3" width="6" height="4" rx="1" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M9 14h6M9 18h4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
          <span>暂无活跃会话</span>
        </div>
      ) : (
        <div
          className="session-list"
          ref={listRef}
          onTouchStart={handlePullTouchStart}
          onTouchMove={handlePullTouchMove}
          onTouchEnd={handlePullTouchEnd}
        >
          {pullDistance > 0 && (
            <div className="pull-refresh-indicator" style={{ height: pullDistance }}>
              {refreshing ? '刷新中...' : pullDistance > 50 ? '松开刷新' : '下拉刷新'}
            </div>
          )}
          {sessionList.map((s) => (
            <SwipeCard key={s.id} onDelete={() => handleDelete(s.id, true)}>
              <div className="session-card" onClick={() => navigate(`/session/${s.id}`)}>
                <div className={`session-card-stripe ${getStatusClass(s)}`} />
                <div className="session-card-body">
                  <div className={`session-status-dot ${getStatusClass(s)}`} />
                  <div className="session-info">
                    <div className="session-name">{s.name || s.id.slice(0, 8)}</div>
                    {s.cwd && <div className="session-cwd">{shortenCwd(s.cwd)}</div>}
                    <div className="session-meta">
                      <span>{s.idleSubStatus === 'approval' ? STATUS_LABEL['approval'] : (STATUS_LABEL[s.status] || s.status)}</span>
                      <span className="session-meta-divider" />
                      <span>{formatTime(s.statusTimestamp)}</span>
                      {s.statusTimestamp && (
                        <>
                          <span className="session-meta-divider" />
                          <span>{formatDuration(s.statusTimestamp)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="session-actions" onClick={(e) => e.stopPropagation()}>
                    <button
                      className={`btn-tag ${autoApproveSessions.has(s.id) ? 'active' : ''}`}
                      onClick={() => {
                        const next = !autoApproveSessions.has(s.id);
                        wsSend({ type: 'session.autoApprove', payload: { sessionId: s.id, enabled: next } });
                        useStore.getState().setAutoApprove(s.id, next);
                        addToast(next ? '自动审批已开启' : '自动审批已关闭', 'info');
                      }}
                    >{autoApproveSessions.has(s.id) ? '自动中' : '自动'}</button>
                    <button
                      className={`btn-tag ${managedSessions.has(s.id) ? 'managed' : ''}`}
                      onClick={() => {
                        if (managedSessions.has(s.id)) {
                          wsSend({ type: 'managed.stop', payload: { sessionId: s.id } });
                        } else {
                          wsSend({ type: 'managed.start', payload: { sessionId: s.id } });
                        }
                      }}
                    >{managedSessions.has(s.id) ? '托管中' : '托管'}</button>
                    <button className="session-delete" onClick={(e) => handleDeleteClick(e, s.id)}>✕</button>
                  </div>
                </div>
              </div>
            </SwipeCard>
          ))}
        </div>
      )}

      <button className="fab" onClick={() => {
        setShowModal(true);
        fetch('/api/projects', { headers: { Authorization: `Bearer ${token}` } })
          .then(r => r.json())
          .then(data => { if (Array.isArray(data)) setProjects(data); })
          .catch(() => {});
      }} title="新建会话">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-tabs">
              <button className={`modal-tab ${modalTab === 'open' ? 'active' : ''}`} onClick={() => setModalTab('open')}>打开项目</button>
              <button className={`modal-tab ${modalTab === 'new' ? 'active' : ''}`} onClick={() => setModalTab('new')}>新建项目</button>
            </div>

            {modalTab === 'open' ? (
              <div className="project-list">
                {projects.map((p) => (
                  <button
                    key={p.path}
                    className="project-item"
                    onClick={() => handleOpenProject(p.path)}
                    disabled={creating}
                  >
                    <span className="project-item-name">{p.name}</span>
                    <span className="project-item-path">{p.path}</span>
                  </button>
                ))}
                {projects.length === 0 && <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: 20 }}>暂无历史项目</div>}
              </div>
            ) : (
              <>
                <label className="modal-label">选择目录</label>
                {projects.length > 0 && (() => {
                  const dirs = [...new Set(projects.map(p => p.path.replace(/\/[^/]+$/, '')))].sort();
                  return (
                    <div className="project-list" style={{ maxHeight: 120 }}>
                      {dirs.map((d) => (
                        <button key={d} className={`project-item ${baseDir === d ? 'selected' : ''}`} onClick={() => setBaseDir(d)}>
                          <span className="project-item-name">{d.split('/').pop()}</span>
                          <span className="project-item-path">{d}</span>
                        </button>
                      ))}
                    </div>
                  );
                })()}
                <label className="modal-label">项目名称</label>
                <div className="new-project-row">
                  <input className="base-dir-input" value={baseDir} onChange={(e) => setBaseDir(e.target.value)} placeholder="父目录" />
                  <span className="path-sep">/</span>
                  <input className="project-name-input" value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="项目名" />
                </div>
                <div className="modal-actions">
                  <button className="btn-cancel" onClick={() => setShowModal(false)}>取消</button>
                  <button className="btn-primary" onClick={handleCreate} disabled={creating || !baseDir.trim()}>
                    {creating ? '创建中...' : '创建'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
