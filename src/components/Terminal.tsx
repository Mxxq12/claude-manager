import { useEffect, useRef, useCallback } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { loadSavedTheme } from '../themes';
import type { Theme } from '../themes';
import '@xterm/xterm/css/xterm.css';

interface Props {
  sessionId: string | null;
  theme?: Theme;
}

const FONT_SIZE_KEY = 'claude-manager-font-size';
const DEFAULT_FONT_SIZE = 12;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 24;

function getSavedFontSize(): number {
  const saved = localStorage.getItem(FONT_SIZE_KEY);
  return saved ? parseInt(saved, 10) : DEFAULT_FONT_SIZE;
}

export function Terminal({ sessionId, theme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current || !sessionId || !window.electronAPI) return;

    const currentTheme = theme || loadSavedTheme();
    const xterm = new XTerm({
      cursorBlink: true,
      fontSize: getSavedFontSize(),
      fontFamily: '"MesloLGS For Powerline", "MesloLGS NF", Menlo, Monaco, monospace',
      fontWeight: 'normal',
      letterSpacing: 0,
      lineHeight: 1.0,
      allowProposedApi: true,
      theme: currentTheme.terminal,
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(containerRef.current);
    fitAddon.fit();
    xtermRef.current = xterm;
    fitAddonRef.current = fitAddon;

    // Sync initial size to pty (delayed to ensure layout is ready)
    setTimeout(() => {
      fitAddon.fit();
      window.electronAPI.resizePty(sessionId, xterm.cols, xterm.rows);
    }, 100);

    // Replay buffer (invoke returns directly, no broadcast)
    window.electronAPI.requestBuffer(sessionId).then((buffer) => {
      if (buffer) {
        for (const chunk of buffer) {
          xterm.write(new Uint8Array(chunk));
        }
      }
      xterm.scrollToBottom();
      setTimeout(() => xterm.scrollToBottom(), 100);
      setTimeout(() => xterm.scrollToBottom(), 300);
    });

    // Live data
    const offData = window.electronAPI.onSessionData((payload) => {
      if (payload.id === sessionId) {
        xterm.write(new Uint8Array(payload.data));
        xterm.scrollToBottom();
      }
    });

    xterm.onData((data) => {
      window.electronAPI.sendInput(sessionId, data);
    });

    // Sync pty size when terminal resizes
    xterm.onResize(({ cols, rows }) => {
      window.electronAPI.resizePty(sessionId, cols, rows);
    });

    const handleResize = () => {
      fitAddon.fit();
      window.electronAPI.resizePty(sessionId, xterm.cols, xterm.rows);
    };
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    // Cmd+/Cmd- to adjust font size, Cmd+0 to reset
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.metaKey) return;
      // Cmd+C: copy with trimmed whitespace
      if (e.key === 'c' && xterm.hasSelection()) {
        e.preventDefault();
        const selection = xterm.getSelection();
        const trimmed = selection.split('\n').map(line => line.trim()).join('\n').trim();
        navigator.clipboard.writeText(trimmed);
        return;
      }
      let newSize: number | null = null;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        newSize = Math.min((xterm.options.fontSize || DEFAULT_FONT_SIZE) + 1, MAX_FONT_SIZE);
      } else if (e.key === '-') {
        e.preventDefault();
        newSize = Math.max((xterm.options.fontSize || DEFAULT_FONT_SIZE) - 1, MIN_FONT_SIZE);
      } else if (e.key === '0') {
        e.preventDefault();
        newSize = DEFAULT_FONT_SIZE;
      }
      if (newSize !== null) {
        xterm.options.fontSize = newSize;
        localStorage.setItem(FONT_SIZE_KEY, String(newSize));
        fitAddon.fit();
        window.electronAPI.resizePty(sessionId, xterm.cols, xterm.rows);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const offClear = window.electronAPI.onClearTerminal((id: string) => {
      if (id === sessionId) {
        xterm.clear();
      }
    });

    const offCopy = window.electronAPI.onCopyTrimmed((id: string) => {
      if (id === sessionId) {
        const selection = xterm.getSelection();
        if (selection) {
          const trimmed = selection.split('\n').map(line => line.trim()).join('\n').trim();
          navigator.clipboard.writeText(trimmed);
        }
      }
    });

    const offPaste = window.electronAPI.onPaste((id: string) => {
      if (id === sessionId) {
        navigator.clipboard.readText().then(text => {
          if (text) window.electronAPI.sendInput(sessionId, text);
        });
      }
    });

    return () => {
      offData();
      offClear();
      offCopy();
      offPaste();
      resizeObserver.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
      xterm.dispose();
      xtermRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId, theme]);

  const handleTerminalDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!sessionId) return;
    const files = e.dataTransfer.files;
    for (let i = 0; i < files.length; i++) {
      const filePath = window.electronAPI.getPathForFile(files[i]);
      if (filePath) {
        window.electronAPI.sendInput(sessionId, filePath);
      }
    }
  }, [sessionId]);

  const handleTerminalDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleTerminalContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (sessionId) {
      window.electronAPI.showSessionContextMenu(sessionId, 'terminal');
    }
  }, [sessionId]);

  if (!sessionId) {
    return <div className="terminal-empty"><p>未选择会话，点击"+ 新建"开始</p></div>;
  }

  return (
    <div
      ref={containerRef}
      className="terminal-container"
      onDrop={handleTerminalDrop}
      onDragOver={handleTerminalDragOver}
      onContextMenu={handleTerminalContextMenu}
    />
  );
}
