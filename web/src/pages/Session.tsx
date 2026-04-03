import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useStore } from '../store/useStore';
import { wsSend, addOutputListener, addBufferListener } from '../hooks/useWebSocket';

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export default function Session() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const session = useStore((s) => (id ? s.sessions.get(id) : undefined));
  const sessions = useStore((s) => s.sessions);
  const termRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const [input, setInput] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [voiceMode, setVoiceMode] = useState(false);
  const recognitionRef = useRef<any>(null);

  // Terminal font size (pinch to zoom)
  const [termFontSize, setTermFontSize] = useState(() => {
    const saved = localStorage.getItem('termFontSize');
    return saved ? Math.min(20, Math.max(8, parseInt(saved, 10))) : 9;
  });
  const pinchStartDistRef = useRef(0);
  const pinchStartFontRef = useRef(10);

  // Session swipe gesture
  const swipeStartXRef = useRef(0);
  const [swipeOffset, setSwipeOffset] = useState(0);
  const swipingRef = useRef(false);
  const pageRef = useRef<HTMLDivElement>(null);

  const sessionList = Array.from(sessions.values()).sort(
    (a, b) => (b.statusTimestamp || 0) - (a.statusTimestamp || 0),
  );

  useEffect(() => {
    if (!termRef.current || !id) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: termFontSize,
      lineHeight: 1.2,
      fontFamily: "'Menlo', 'Monaco', 'Courier New', monospace",
      theme: {
        background: '#010409',
        foreground: '#e6edf3',
        cursor: '#58a6ff',
        selectionBackground: '#58a6ff44',
        black: '#0d1117',
        brightBlack: '#6e7681',
      },
      cols: 120,
      rows: 50,
      scrollback: 5000,
      scrollSensitivity: 3,
      fastScrollSensitivity: 10,
      smoothScrollDuration: 100,
      convertEol: true,
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(termRef.current);

    terminalRef.current = terminal;
    fitRef.current = fitAddon;

    // Disable terminal keyboard input (use bottom input bar only)
    terminal.attachCustomKeyEventHandler(() => false);

    // Listen for live output
    const removeOutput = addOutputListener(id, (data) => {
      terminal.write(base64ToUint8Array(data));
    });

    // Listen for buffer replay (register BEFORE requesting)
    const removeBuffer = addBufferListener(id, (chunks) => {
      for (const chunk of chunks) {
        terminal.write(base64ToUint8Array(chunk));
      }
      terminal.scrollToBottom();
    });

    // Request history buffer after listeners are registered (with retry)
    const requestBuffer = () => wsSend({ type: 'session.buffer', payload: { sessionId: id } });
    requestBuffer();
    // Retry after delays in case WS wasn't ready
    const t1 = setTimeout(requestBuffer, 1000);
    const t2 = setTimeout(requestBuffer, 3000);

    // No auto-fit — fixed 120 cols, mobile scrolls horizontally

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      removeOutput();
      removeBuffer();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  // Update terminal font size when changed via pinch
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.fontSize = termFontSize;
    }
    localStorage.setItem('termFontSize', String(termFontSize));
  }, [termFontSize]);

  // Pinch-to-zoom handlers on terminal container
  const handleTermTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchStartDistRef.current = Math.sqrt(dx * dx + dy * dy);
      pinchStartFontRef.current = termFontSize;
    }
  }, [termFontSize]);

  const handleTermTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchStartDistRef.current > 0) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const scale = dist / pinchStartDistRef.current;
      const newSize = Math.round(Math.min(20, Math.max(10, pinchStartFontRef.current * scale)));
      setTermFontSize(newSize);
    }
  }, []);

  const handleTermTouchEnd = useCallback(() => {
    pinchStartDistRef.current = 0;
  }, []);

  // Session swipe handlers
  const handleSwipeTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      swipeStartXRef.current = e.touches[0].clientX;
      swipingRef.current = false;
    }
  }, []);

  const handleSwipeTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - swipeStartXRef.current;
    if (Math.abs(dx) > 30) {
      swipingRef.current = true;
      setSwipeOffset(dx * 0.3);
    }
  }, []);

  const handleSwipeTouchEnd = useCallback(() => {
    if (!swipingRef.current || !id) {
      setSwipeOffset(0);
      return;
    }
    const currentIdx = sessionList.findIndex((s) => s.id === id);
    if (swipeOffset > 50 && currentIdx > 0) {
      // Swipe right -> previous session
      navigate(`/session/${sessionList[currentIdx - 1].id}`, { replace: true });
    } else if (swipeOffset < -50 && currentIdx < sessionList.length - 1) {
      // Swipe left -> next session
      navigate(`/session/${sessionList[currentIdx + 1].id}`, { replace: true });
    }
    setSwipeOffset(0);
    swipingRef.current = false;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, swipeOffset, sessionList, navigate]);

  const handleSend = useCallback(() => {
    if (!id) return;
    wsSend({ type: 'session.input', payload: { sessionId: id, text: input } });
    setInput('');
  }, [id, input]);

  const startRecording = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (e: any) => {
      let text = '';
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
      }
      setInput(text);
    };
    recognition.onerror = () => { setIsRecording(false); };
    recognition.onend = () => { setIsRecording(false); };
    recognition.start();
    recognitionRef.current = recognition;
    setIsRecording(true);
  }, []);

  const stopRecording = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    setIsRecording(false);
    // Auto-send after recognition completes
    setTimeout(() => {
      const currentInput = (document.querySelector('.toolbar-input-row input') as HTMLInputElement)?.value;
      if (currentInput?.trim() && id) {
        wsSend({ type: 'session.input', payload: { sessionId: id, text: currentInput } });
        setInput('');
      }
    }, 500);
  }, [id]);

  const handleApprove = useCallback(() => {
    if (!id) return;
    wsSend({ type: 'session.approve', payload: { sessionId: id } });
  }, [id]);

  const handleKill = useCallback(() => {
    if (!id) return;
    wsSend({ type: 'session.kill', payload: { sessionId: id } });
  }, [id]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  const status = session?.status || 'idle';
  const isApproval = session?.idleSubStatus === 'approval';
  const isClosed = status === 'closed' || status === 'error';
  const displayName = session?.name || session?.cwd || id || '会话';

  const statusLabel = isClosed ? (status === 'error' ? '异常退出' : '已关闭') : isApproval ? '待审批' : status === 'idle' ? '空闲' : status === 'busy' ? '忙碌' : status;
  const statusClass = isClosed ? 'closed' : isApproval ? 'approval' : status;

  // Session not found in store (deleted or never existed)
  if (!session && id) {
    return (
      <div className="page session-page">
        <div className="session-header">
          <button className="btn-back" onClick={() => navigate('/')}>
            <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <span className="session-header-title">会话不存在</span>
        </div>
        <div style={{ padding: 40, color: 'var(--text-tertiary)', textAlign: 'center', fontSize: 14 }}>该会话已关闭或不存在</div>
      </div>
    );
  }

  return (
    <div
      className="page session-page"
      ref={pageRef}
      style={{ transform: swipeOffset ? `translateX(${swipeOffset}px)` : undefined, transition: swipeOffset ? 'none' : 'transform 0.3s ease' }}
      onTouchStart={handleSwipeTouchStart}
      onTouchMove={handleSwipeTouchMove}
      onTouchEnd={handleSwipeTouchEnd}
    >
      <div className="session-header">
        <button className="btn-back" onClick={() => navigate('/')}>
          <svg viewBox="0 0 24 24"><path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        <span className="session-header-title">{displayName}</span>
        <span className={`session-header-status ${statusClass}`}>
          <span className="status-dot-sm" />
          {statusLabel}
        </span>
      </div>

      <div className="terminal-wrapper">
        <div
          className="terminal-container"
          ref={termRef}
          onTouchStart={handleTermTouchStart}
          onTouchMove={handleTermTouchMove}
          onTouchEnd={handleTermTouchEnd}
        />
        <div className="scroll-controls">
          <button className="scroll-btn" onClick={() => terminalRef.current?.scrollLines(-10)}>▲</button>
          <input
            type="range"
            className="scroll-slider"
            min="0"
            max="100"
            defaultValue="100"
            orient="vertical"
            onChange={(e) => {
              if (!terminalRef.current) return;
              const buf = terminalRef.current.buffer.active;
              const maxScroll = buf.baseY;
              const target = Math.round((parseInt(e.target.value) / 100) * maxScroll);
              terminalRef.current.scrollToLine(target);
            }}
          />
          <button className="scroll-btn" onClick={() => terminalRef.current?.scrollLines(10)}>▼</button>
          <button className="scroll-btn scroll-bottom" onClick={() => terminalRef.current?.scrollToBottom()}>⤓</button>
        </div>
      </div>

      {isApproval && !isClosed && (
        <div className="approval-banner">
          <span className="approval-banner-icon">⚠️</span>
          <span className="approval-banner-text">Claude 请求执行操作，需要您的审批</span>
          <button className="btn-approve-banner" onClick={handleApprove}>批准</button>
        </div>
      )}

      {isClosed ? (
        <div className="session-toolbar closed-banner">
          <span style={{ color: 'var(--danger)', fontWeight: 600 }}>{statusLabel}</span>
          <button className="btn-back" onClick={() => navigate('/')}>
            <svg viewBox="0 0 24 24" style={{ width: 16, height: 16, marginRight: 4 }}><path d="M19 12H5M12 19l-7-7 7-7" strokeLinecap="round" strokeLinejoin="round"/></svg>
            返回列表
          </button>
        </div>
      ) : (
        <>
        <div className="toolbar-float-keys">
          <button className="btn-float-key" onClick={() => wsSend({ type: 'session.rawInput', payload: { sessionId: id, data: '\x1b[A' } })}>▲</button>
          <button className="btn-float-key" onClick={() => wsSend({ type: 'session.rawInput', payload: { sessionId: id, data: '\x1b[B' } })}>▼</button>
          <button className="btn-float-key" onClick={() => wsSend({ type: 'session.rawInput', payload: { sessionId: id, data: '\r' } })}>⏎</button>
          <button className="btn-float-key" onClick={() => wsSend({ type: 'session.rawInput', payload: { sessionId: id, data: '\x1b' } })}>✕</button>
        </div>
        <div className="session-toolbar">
          <div className="toolbar-input-row">
            <button className="btn-mode-switch" onClick={() => setVoiceMode(!voiceMode)}>
              {voiceMode ? '⌨️' : '🎤'}
            </button>
            {voiceMode ? (
              <button
                className={`btn-voice-hold ${isRecording ? 'recording' : ''}`}
                onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
                onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={() => { if (isRecording) stopRecording(); }}
              >{isRecording ? '松开 发送' : '按住 说话'}</button>
            ) : (
              <>
                <textarea
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    e.target.style.height = 'auto';
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="输入消息..."
                  rows={1}
                />
                <button className="btn-send" onClick={handleSend} title="发送">
                  <svg viewBox="0 0 24 24"><path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
                </button>
              </>
            )}
          </div>
          {isApproval && <button className="btn-approve" onClick={handleApprove}>批准</button>}
        </div>
        </>
      )}
    </div>
  );
}
