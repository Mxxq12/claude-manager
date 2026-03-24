import { useEffect, useState } from 'react';
import type { SessionInfo } from '../types';

interface Props {
  session: SessionInfo | null;
}

export function StatusBar({ session }: Props) {
  const [elapsed, setElapsed] = useState('');

  useEffect(() => {
    if (!session) return;
    const update = () => {
      const seconds = Math.floor((Date.now() - session.statusTimestamp) / 1000);
      if (seconds < 60) setElapsed(`${seconds}秒`);
      else if (seconds < 3600) setElapsed(`${Math.floor(seconds / 60)}分钟`);
      else setElapsed(`${Math.floor(seconds / 3600)}小时`);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [session?.statusTimestamp]);

  if (!session) return <footer className="status-bar" />;

  const statusLabel = session.status === 'idle'
    ? (session.idleSubStatus === 'approval' ? '🟡 等待确认' : '🟢 空闲')
    : session.status === 'busy' ? '🔵 忙碌'
    : session.status === 'error' ? '🔴 错误'
    : session.status === 'closed' ? '已关闭'
    : session.status === 'starting' ? '启动中'
    : session.status;

  return (
    <footer className="status-bar">
      <span className="status-bar-name">{session.name}</span>
      <span className="status-bar-cwd">{session.cwd}</span>
      <span className="status-bar-status">{statusLabel}</span>
      <span className="status-bar-elapsed">{elapsed}</span>
    </footer>
  );
}
