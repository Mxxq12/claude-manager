import type { SessionInfo } from '../types';

const STATUS_INDICATOR: Record<string, string> = {
  idle: '🟢', busy: '🔵', starting: '🔵', error: '🔴', closed: '⚫', created: '⚪',
};

function getStatusLabel(session: SessionInfo): string {
  if (session.status === 'idle') {
    return session.idleSubStatus === 'approval' ? 'waiting approval' : 'idle';
  }
  return session.status;
}

function getElapsedTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}

interface Props {
  session: SessionInfo;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
}

export function SessionCard({ session, isActive, onClick, onClose, onRename }: Props) {
  const indicator = session.status === 'idle' && session.idleSubStatus === 'approval' ? '🟡' : STATUS_INDICATOR[session.status];

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const name = prompt('Rename session:', session.name);
    if (name) onRename(name);
  };

  return (
    <div className={`session-card ${isActive ? 'active' : ''} status-${session.status}`} onClick={onClick} onContextMenu={handleContextMenu}>
      <div className="session-card-header">
        <span className="status-indicator">{indicator}</span>
        <span className="session-name">{session.name}</span>
        <button className="close-btn" onClick={(e) => { e.stopPropagation(); onClose(); }}>×</button>
      </div>
      <div className="session-card-meta">
        <span className="session-status">{getStatusLabel(session)}</span>
        <span className="session-elapsed">{getElapsedTime(session.statusTimestamp)}</span>
      </div>
    </div>
  );
}
