import { useEffect, useRef, useCallback, useState } from 'react';
import { Terminal as XTerm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { loadSavedTheme } from '../themes';
import type { Theme } from '../themes';
import '@xterm/xterm/css/xterm.css';

interface Props {
  sessionId: string | null;
  theme?: Theme;
  readOnly?: boolean;
}

const FONT_SIZE_KEY = 'claude-manager-font-size';
const DEFAULT_FONT_SIZE = 12;
const MIN_FONT_SIZE = 8;
const MAX_FONT_SIZE = 24;

function getSavedFontSize(): number {
  const saved = localStorage.getItem(FONT_SIZE_KEY);
  return saved ? parseInt(saved, 10) : DEFAULT_FONT_SIZE;
}

interface CachedTerminal {
  xterm: XTerm;
  fitAddon: FitAddon;
  searchAddon: SearchAddon;
  element: HTMLDivElement;
  cleanups: (() => void)[];
}

// Global cache of terminal instances keyed by sessionId
const terminalCache = new Map<string, CachedTerminal>();
// Sessions that are read-only (managed executor)
const readOnlySessions = new Set<string>();

function createTerminal(sessionId: string, theme: Theme): CachedTerminal {
  const element = document.createElement('div');
  element.style.width = '100%';
  element.style.height = '100%';

  const xterm = new XTerm({
    cursorBlink: true,
    fontSize: getSavedFontSize(),
    fontFamily: '"MesloLGS For Powerline", "MesloLGS NF", Menlo, Monaco, monospace',
    fontWeight: 'normal',
    letterSpacing: 0,
    lineHeight: 1.0,
    scrollback: 10000,
    allowProposedApi: true,
    theme: theme.terminal,
  });

  const fitAddon = new FitAddon();
  const searchAddon = new SearchAddon();
  xterm.loadAddon(fitAddon);
  xterm.loadAddon(searchAddon);
  xterm.loadAddon(new WebLinksAddon((_, uri) => {
    window.electronAPI.openExternal(uri);
  }));
  xterm.open(element);

  // Enable GPU-accelerated rendering, fallback to canvas if WebGL unavailable
  try {
    const webglAddon = new WebglAddon();
    webglAddon.onContextLoss(() => { webglAddon.dispose(); });
    xterm.loadAddon(webglAddon);
  } catch {
    // WebGL not available, use default canvas renderer
  }

  // Register path link provider
  const pathRegex = /(~\/[^\s'",)}\]]+|\/(?:Users|home|tmp|var|opt|etc)[^\s'",)}\]]+)/;
  xterm.registerLinkProvider({
    provideLinks(lineNumber, callback) {
      const line = xterm.buffer.active.getLine(lineNumber - 1);
      if (!line) { callback(undefined); return; }
      const text = line.translateToString();
      const match = pathRegex.exec(text);
      if (match) {
        const before = text.substring(0, match.index).trim();
        if (before && /[a-zA-Z0-9_-]$/.test(before)) {
          callback(undefined);
          return;
        }
        let startCol = 0;
        for (let i = 0; i < match.index; i++) {
          const code = text.charCodeAt(i);
          startCol += (code > 0x7F && code < 0xFFFF) ? 2 : 1;
        }
        const endCol = startCol + match[0].length;
        callback([{
          range: { start: { x: startCol + 1, y: lineNumber }, end: { x: endCol, y: lineNumber } },
          text: match[0],
          activate(_event, text) {
            window.electronAPI.openPath(text);
          },
        }]);
      } else {
        callback(undefined);
      }
    },
  });

  // Shift+Enter sends newline, Cmd+V handles clipboard images
  xterm.attachCustomKeyEventHandler((e) => {
    if (e.type === 'keydown' && e.key === 'Enter' && e.shiftKey) {
      e.preventDefault();
      window.electronAPI.sendInput(sessionId, '\n');
      return false;
    }
    if (e.type === 'keydown' && e.key === 'v' && e.metaKey) {
      e.preventDefault();
      window.electronAPI.saveClipboardImage().then((imagePath) => {
        if (imagePath) {
          window.electronAPI.sendInput(sessionId, imagePath);
        } else {
          navigator.clipboard.readText().then((text) => {
            if (text) window.electronAPI.sendInput(sessionId, text);
          });
        }
      });
      return false;
    }
    return true;
  });

  // Forward input to PTY (blocked if session is read-only)
  xterm.onData((data) => {
    if (readOnlySessions.has(sessionId)) return;
    window.electronAPI.sendInput(sessionId, data);
    window.dispatchEvent(new CustomEvent('session-user-input', { detail: sessionId }));
  });

  // Sync pty size
  xterm.onResize(({ cols, rows }) => {
    window.electronAPI.resizePty(sessionId, cols, rows);
  });

  const cleanups: (() => void)[] = [];

  // Live data listener
  const offData = window.electronAPI.onSessionData((payload) => {
    if (payload.id === sessionId) {
      xterm.write(new Uint8Array(payload.data));
      xterm.scrollToBottom();
    }
  });
  cleanups.push(offData);

  // Clear terminal listener
  const offClear = window.electronAPI.onClearTerminal((id: string) => {
    if (id === sessionId) {
      xterm.clear();
      window.electronAPI.clearBuffer(sessionId);
    }
  });
  cleanups.push(offClear);

  // Copy trimmed listener
  const offCopy = window.electronAPI.onCopyTrimmed((id: string) => {
    if (id === sessionId) {
      const selection = xterm.getSelection();
      if (selection) {
        const trimmed = selection.split('\n').map(line => line.trim()).join('\n').trim();
        navigator.clipboard.writeText(trimmed);
      }
    }
  });
  cleanups.push(offCopy);

  // Paste listener
  const offPaste = window.electronAPI.onPaste((id: string) => {
    if (id === sessionId) {
      navigator.clipboard.readText().then(text => {
        if (text) window.electronAPI.sendInput(sessionId, text);
      });
    }
  });
  cleanups.push(offPaste);

  // Replay buffer once on creation
  window.electronAPI.requestBuffer(sessionId).then((buffer) => {
    if (buffer && buffer.length > 0) {
      let i = 0;
      const BATCH_SIZE = 50;
      const writeBatch = () => {
        const end = Math.min(i + BATCH_SIZE, buffer.length);
        for (; i < end; i++) {
          xterm.write(new Uint8Array(buffer[i]));
        }
        if (i < buffer.length) {
          requestAnimationFrame(writeBatch);
        } else {
          xterm.scrollToBottom();
        }
      };
      requestAnimationFrame(writeBatch);
    }
    xterm.scrollToBottom();
    setTimeout(() => xterm.scrollToBottom(), 100);
    setTimeout(() => xterm.scrollToBottom(), 300);
  });

  const cached: CachedTerminal = { xterm, fitAddon, searchAddon, element, cleanups };
  terminalCache.set(sessionId, cached);
  return cached;
}

// Clean up a cached terminal when session is closed
function destroyTerminal(sessionId: string) {
  const cached = terminalCache.get(sessionId);
  if (!cached) return;
  cached.cleanups.forEach((fn) => fn());
  cached.xterm.dispose();
  cached.element.remove();
  terminalCache.delete(sessionId);
}

// Listen for session close events to clean up cache
if (typeof window !== 'undefined' && window.electronAPI) {
  window.electronAPI.onSessionClosed?.((payload) => {
    destroyTerminal(payload.id);
  });
}

export function Terminal({ sessionId, theme, readOnly }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentSessionRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Sync readOnly state
  useEffect(() => {
    if (!sessionId) return;
    if (readOnly) {
      readOnlySessions.add(sessionId);
    } else {
      readOnlySessions.delete(sessionId);
    }
  }, [sessionId, readOnly]);

  // Update theme on all cached terminals
  useEffect(() => {
    if (!theme) return;
    for (const cached of terminalCache.values()) {
      cached.xterm.options.theme = theme.terminal;
    }
  }, [theme]);

  // Mount/unmount terminal elements on session switch
  useEffect(() => {
    if (!containerRef.current || !sessionId || !window.electronAPI) return;

    const currentTheme = theme || loadSavedTheme();
    let cached = terminalCache.get(sessionId);
    if (!cached) {
      cached = createTerminal(sessionId, currentTheme);
    }

    // Mount the terminal element into the container
    containerRef.current.appendChild(cached.element);
    currentSessionRef.current = sessionId;

    // Fit and sync size
    cached.fitAddon.fit();
    window.electronAPI.resizePty(sessionId, cached.xterm.cols, cached.xterm.rows);
    cached.xterm.scrollToBottom();
    cached.xterm.focus();

    // Resize observer
    const resizeObserver = new ResizeObserver(() => {
      cached!.fitAddon.fit();
      window.electronAPI.resizePty(sessionId, cached!.xterm.cols, cached!.xterm.rows);
    });
    resizeObserver.observe(containerRef.current);

    // Keyboard shortcuts (font size, copy, search)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === 'f') {
        e.preventDefault();
        setShowSearch(true);
        setTimeout(() => searchInputRef.current?.focus(), 50);
        return;
      }
      if (e.key === 'Escape') {
        setShowSearch(false);
        setSearchQuery('');
        cached!.searchAddon.clearDecorations();
        cached!.xterm.focus();
        return;
      }
      if (!e.metaKey) return;
      if (e.key === 'c' && cached!.xterm.hasSelection()) {
        e.preventDefault();
        const selection = cached!.xterm.getSelection();
        const trimmed = selection.split('\n').map(line => line.trim()).join('\n').trim();
        navigator.clipboard.writeText(trimmed);
        return;
      }
      let newSize: number | null = null;
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        newSize = Math.min((cached!.xterm.options.fontSize || DEFAULT_FONT_SIZE) + 1, MAX_FONT_SIZE);
      } else if (e.key === '-') {
        e.preventDefault();
        newSize = Math.max((cached!.xterm.options.fontSize || DEFAULT_FONT_SIZE) - 1, MIN_FONT_SIZE);
      } else if (e.key === '0') {
        e.preventDefault();
        newSize = DEFAULT_FONT_SIZE;
      }
      if (newSize !== null) {
        cached!.xterm.options.fontSize = newSize;
        localStorage.setItem(FONT_SIZE_KEY, String(newSize));
        cached!.fitAddon.fit();
        window.electronAPI.resizePty(sessionId, cached!.xterm.cols, cached!.xterm.rows);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('keydown', handleKeyDown);
      // Detach element from container but keep it alive in cache
      if (cached!.element.parentNode) {
        cached!.element.parentNode.removeChild(cached!.element);
      }
      currentSessionRef.current = null;
    };
  }, [sessionId]);

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

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (!sessionId) return;
    const cached = terminalCache.get(sessionId);
    if (!cached) return;
    if (query) {
      cached.searchAddon.findNext(query);
    } else {
      cached.searchAddon.clearDecorations();
    }
  }, [sessionId]);

  const handleSearchKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!sessionId) return;
      const cached = terminalCache.get(sessionId);
      if (!cached) return;
      if (e.shiftKey) {
        cached.searchAddon.findPrevious(searchQuery);
      } else {
        cached.searchAddon.findNext(searchQuery);
      }
    }
    if (e.key === 'Escape') {
      setShowSearch(false);
      setSearchQuery('');
      if (sessionId) {
        const cached = terminalCache.get(sessionId);
        cached?.searchAddon.clearDecorations();
        cached?.xterm.focus();
      }
    }
  }, [sessionId, searchQuery]);

  if (!sessionId) {
    return <div className="terminal-empty"><p>未选择会话，点击"+ 新建"开始</p></div>;
  }

  return (
    <>
      {showSearch && (
        <div className="terminal-search-bar">
          <input
            ref={searchInputRef}
            className="terminal-search-input"
            type="text"
            placeholder="搜索..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <button className="terminal-search-btn" onClick={() => {
            const cached = sessionId ? terminalCache.get(sessionId) : null;
            cached?.searchAddon.findPrevious(searchQuery);
          }}>▲</button>
          <button className="terminal-search-btn" onClick={() => {
            const cached = sessionId ? terminalCache.get(sessionId) : null;
            cached?.searchAddon.findNext(searchQuery);
          }}>▼</button>
          <button className="terminal-search-btn" onClick={() => {
            setShowSearch(false);
            setSearchQuery('');
            const cached = sessionId ? terminalCache.get(sessionId) : null;
            cached?.searchAddon.clearDecorations();
            cached?.xterm.focus();
          }}>×</button>
        </div>
      )}
      <div
        ref={containerRef}
        className="terminal-container"
        onDrop={handleTerminalDrop}
        onDragOver={handleTerminalDragOver}
        onContextMenu={handleTerminalContextMenu}
      />
    </>
  );
}
