import { useEffect, useState } from 'react';
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
  onClick: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
  onRestart: () => void;
}

export function SessionCard({ session, isActive, onClick, onClose, onRename, onRestart }: Props) {
  const indicator = session.status === 'idle' && session.idleSubStatus === 'approval' ? '🟡' : STATUS_INDICATOR[session.status];
  const [elapsed, setElapsed] = useState('');

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
    if (session.status === 'busy') {
      const confirmed = window.confirm(`确认关闭会话 '${session.name}'？正在运行的任务将被终止`);
      if (!confirmed) return;
    }
    onClose();
  };

  const handleRestart = (e: React.MouseEvent) => {
    e.stopPropagation();
    onRestart();
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const name = prompt('重命名会话:', session.name);
    if (name) onRename(name);
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
      className={`session-card ${isActive ? 'active' : ''} status-${session.status}`}
      onClick={onClick}
      onContextMenu={handleContextMenu}
      title={session.cwd}
    >
      <div className="session-card-header">
        <span className="status-indicator">{indicator}</span>
        <span className="session-name">{session.name}</span>
        {session.status === 'error' && (
          <button className="restart-btn" onClick={handleRestart} title="重启会话">↻</button>
        )}
        <button className="close-btn" onClick={handleClose}>×</button>
      </div>
      <div className="session-card-meta">
        <span className="session-status">{statusWithTime}</span>
        <span className="session-elapsed">{elapsed}</span>
      </div>
    </div>
  );
}
