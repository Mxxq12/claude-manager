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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const filePath = window.electronAPI.getPathForFile(files[i]);
      if (filePath) paths.push(filePath);
    }
    if (paths.length > 0) {
      setValue((prev) => (prev ? prev + ' ' : '') + paths.join(' '));
      inputRef.current?.focus();
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  return (
    <div className="input-bar" onDrop={handleDrop} onDragOver={handleDragOver}>
      <input
        ref={inputRef}
        className="input-bar-field"
        type="text"
        placeholder="输入消息或拖入文件..."
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
