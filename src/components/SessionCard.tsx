import { useEffect, useState, useRef } from 'react';
import type { SessionInfo } from '../types';

const STATUS_INDICATOR: Record<string, string> = {
  idle: '🟢', busy: '🔵', starting: '🔵', error: '🔴', closed: '⚫', created: '⚪',
};

function getStatusLabel(session: SessionInfo): string {
  if (session.status === 'idle') {
    return session.idleSubStatus === 'approval' ? '等待确认' : '空闲';
  }
  const labels: Record<string, string> = {
    busy: '忙碌', starting: '启动中', error: '错误', closed: '已关闭', created: '已创建',
  };
  return labels[session.status] ?? session.status;
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟`;
  return `${Math.floor(minutes / 60)}小时`;
}

interface Props {
  session: SessionInfo;
  isActive: boolean;
  isNewlyIdle?: boolean;
  onClick: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
  onRestart: () => void;
  onClearTerminal: () => void;
}

export function SessionCard({ session, isActive, isNewlyIdle, onClick, onClose, onRename, onRestart, onClearTerminal }: Props) {
  const indicator = session.status === 'idle' && session.idleSubStatus === 'approval' ? '🟠' : STATUS_INDICATOR[session.status];
  const [elapsed, setElapsed] = useState('');
  const [autoApprove, setAutoApprove] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // Live-updating elapsed time
  useEffect(() => {
    const update = () => {
      const ms = Date.now() - session.statusTimestamp;
      setElapsed(formatElapsed(ms));
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [session.statusTimestamp]);

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation();
    const isActive = session.status === 'busy' || session.status === 'starting' || session.status === 'created';
    const msg = isActive
      ? `确认关闭会话 '${session.name}'？正在运行的任务将被终止`
      : `确认关闭会话 '${session.name}'？`;
    if (!window.confirm(msg)) return;
    onClose();
  };

  const handleRestart = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRestart();
  };

  const startEditing = () => {
    setEditName(session.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  };

  // Listen for rename request from native context menu
  useEffect(() => {
    const handler = (e: Event) => {
      if ((e as CustomEvent).detail === session.id) {
        startEditing();
      }
    };
    window.addEventListener('session:start-rename', handler);
    return () => window.removeEventListener('session:start-rename', handler);
  }, [session.id]);

  // Cancel editing when clicking outside or switching sessions
  useEffect(() => {
    if (!editing) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (inputRef.current && !inputRef.current.contains(e.target as Node)) {
        finishEditing();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editing, editName]);

  const finishEditing = () => {
    setEditing(false);
    const trimmed = editName.trim();
    if (trimmed && trimmed !== session.name) {
      onRename(trimmed);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    window.electronAPI.showSessionContextMenu(session.id);
  };

  // Task timing label: "忙碌 2分钟" or "空闲 5分钟"
  const statusWithTime = (() => {
    const label = getStatusLabel(session);
    if (session.status === 'busy' || session.status === 'idle') {
      return `${label} ${elapsed}`;
    }
    return label;
  })();

  return (
    <div
      className={`session-card ${isActive ? 'active' : ''} status-${session.status} ${autoApprove ? 'auto-approve-active' : ''} ${isNewlyIdle ? 'newly-idle' : ''}`}
      onClick={onClick}
      onContextMenu={handleContextMenu}
      title={session.cwd}
    >
      <div className="session-card-header">
        <span className="status-indicator">{indicator}</span>
        {editing ? (
          <input
            ref={inputRef}
            className="session-name-input"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onBlur={finishEditing}
            onKeyDown={(e) => {
              if (e.key === 'Enter') finishEditing();
              if (e.key === 'Escape') setEditing(false);
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="session-name" onDoubleClick={(e) => { e.stopPropagation(); startEditing(); }}>{session.name}</span>
        )}
        {session.status === 'error' && (
          <button className="restart-btn" onClick={handleRestart} title="重启会话">↻</button>
        )}
        <button className="close-btn" onClick={handleClose}>×</button>
      </div>
      <div className="session-card-meta">
        <span className="session-status">{statusWithTime}</span>
        <button
          className={`auto-approve-toggle ${autoApprove ? 'on' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            const next = !autoApprove;
            setAutoApprove(next);
            window.electronAPI.setAutoApproveSession(session.id, next);
          }}
          title={autoApprove ? '关闭自动审批' : '开启自动审批'}
        >
          {autoApprove ? '自动中' : '自动'}
        </button>
      </div>
    </div>
  );
}
