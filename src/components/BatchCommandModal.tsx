import { useState, useMemo } from 'react';
import type { SessionInfo } from '../types';

interface Props {
  sessions: SessionInfo[];
  onClose: () => void;
}

export function BatchCommandModal({ sessions, onClose }: Props) {
  const [command, setCommand] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const activeSessions = useMemo(
    () => sessions.filter((s) => s.status !== 'closed'),
    [sessions]
  );

  const allSelected = activeSessions.length > 0 && activeSessions.every((s) => selectedIds.has(s.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(activeSessions.map((s) => s.id)));
    }
  };

  const toggleSession = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleSend = () => {
    if (!command.trim() || selectedIds.size === 0 || !window.electronAPI) return;
    for (const id of selectedIds) {
      window.electronAPI.sendInput(id, command + '\n');
    }
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="batch-modal-overlay" onClick={onClose}>
      <div className="batch-modal" onClick={(e) => e.stopPropagation()}>
        <div className="batch-modal-header">
          <span>批量指令</span>
          <button className="batch-modal-close" onClick={onClose}>×</button>
        </div>
        <div className="batch-modal-body">
          <input
            className="batch-modal-input"
            type="text"
            placeholder="输入指令..."
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <div className="batch-modal-sessions">
            <label className="batch-modal-check">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              <span>全选</span>
            </label>
            <div className="batch-modal-list">
              {activeSessions.map((s) => (
                <label key={s.id} className="batch-modal-check">
                  <input
                    type="checkbox"
                    checked={selectedIds.has(s.id)}
                    onChange={() => toggleSession(s.id)}
                  />
                  <span>{s.name}</span>
                  <span className="batch-modal-cwd">{s.cwd}</span>
                </label>
              ))}
              {activeSessions.length === 0 && (
                <div className="batch-modal-empty">没有活跃的会话</div>
              )}
            </div>
          </div>
        </div>
        <div className="batch-modal-footer">
          <button className="batch-modal-cancel" onClick={onClose}>取消</button>
          <button
            className="batch-modal-send"
            onClick={handleSend}
            disabled={!command.trim() || selectedIds.size === 0}
          >
            发送 ({selectedIds.size})
          </button>
        </div>
      </div>
    </div>
  );
}
