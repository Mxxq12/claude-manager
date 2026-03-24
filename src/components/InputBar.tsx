import { useState, useRef } from 'react';

interface Props {
  sessionId: string | null;
}

export function InputBar({ sessionId }: Props) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSend = () => {
    if (!value.trim() || !sessionId || !window.electronAPI) return;
    window.electronAPI.sendInput(sessionId, value + '\n');
    setValue('');
    inputRef.current?.focus();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="input-bar">
      <input
        ref={inputRef}
        className="input-bar-field"
        type="text"
        placeholder="输入消息..."
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={!sessionId}
      />
      <button
        className="input-bar-send"
        onClick={handleSend}
        disabled={!sessionId || !value.trim()}
      >
        发送
      </button>
    </div>
  );
}
