import { useEffect, useState } from 'react';
import type { SessionInfo } from '../types';

interface Props {
  session: SessionInfo | null;
}

export function StatusBar({ session }: Props) {
  const [elapsed, setElapsed] = useState('');
  const [uptime, setUptime] = useState('');

  useEffect(() => {
    if (!session) return;
    const update = () => {
      // Status elapsed
      const seconds = Math.floor((Date.now() - session.statusTimestamp) / 1000);
      if (seconds < 60) setElapsed(`${seconds}秒`);
      else if (seconds < 3600) setElapsed(`${Math.floor(seconds / 60)}分钟`);
      else setElapsed(`${Math.floor(seconds / 3600)}小时`);

      // Session uptime (since creation)
      const uptimeSec = Math.floor((Date.now() - session.createdAt) / 1000);
      if (uptimeSec < 60) setUptime(`${uptimeSec}秒`);
      else if (uptimeSec < 3600) setUptime(`${Math.floor(uptimeSec / 60)}分钟`);
      else {
        const h = Math.floor(uptimeSec / 3600);
        const m = Math.floor((uptimeSec % 3600) / 60);
        setUptime(`${h}小时${m}分钟`);
      }
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [session?.statusTimestamp, session?.createdAt]);

  if (!session) return <footer className="status-bar" />;

  const statusLabel = session.status === 'idle'
    ? (session.idleSubStatus === 'approval' ? '🟡 等待确认' : '🟢 空闲')
    : session.status === 'busy' ? '🔵 忙碌'
    : session.status === 'error' ? '🔴 错误'
    : session.status === 'closed' ? '已关闭'
    : session.status === 'starting' ? '启动中'
    : session.status;

  const usageDisplay = (() => {
    if (!session.usage) return null;
    const { percent, type, resetsAt, limited } = session.usage;
    if (limited) return `⛔ ${type || '用量'}已达上限 · 重置 ${resetsAt || ''}`;
    if (percent != null) return `📊 ${type || '用量'} ${percent}% · 重置 ${resetsAt || ''}`;
    return null;
  })();

  return (
    <footer className="status-bar">
      <span className="status-bar-name">{session.name}</span>
      <span className="status-bar-cwd">{session.cwd}</span>
      <span className="status-bar-status">{statusLabel}</span>
      <span className="status-bar-elapsed">{elapsed}</span>
      {usageDisplay && (
        <span className={`status-bar-usage ${session.usage?.limited ? 'limited' : 'warning'}`}>
          {usageDisplay}
        </span>
      )}
      <span className="status-bar-cost">运行 {uptime}</span>
    </footer>
  );
}
