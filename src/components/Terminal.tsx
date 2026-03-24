import { useEffect, useRef } from 'react';
import { Terminal as XTerm } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';

interface Props {
  sessionId: string | null;
}

export function Terminal({ sessionId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);

  useEffect(() => {
    if (!containerRef.current || !sessionId) return;

    const xterm = new XTerm({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: { background: '#1e1e2e', foreground: '#cdd6f4', cursor: '#f5e0dc' },
    });

    const fitAddon = new FitAddon();
    xterm.loadAddon(fitAddon);
    xterm.open(containerRef.current);
    fitAddon.fit();
    xtermRef.current = xterm;

    window.electronAPI.requestBuffer(sessionId);

    const offBuffer = window.electronAPI.onSessionBufferData((payload) => {
      if (payload.id === sessionId) xterm.write(new Uint8Array(payload.data));
    });

    const offData = window.electronAPI.onSessionData((payload) => {
      if (payload.id === sessionId) xterm.write(new Uint8Array(payload.data));
    });

    xterm.onData((data) => {
      window.electronAPI.sendInput(sessionId, data);
    });

    const handleResize = () => fitAddon.fit();
    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerRef.current);

    return () => {
      offBuffer();
      offData();
      resizeObserver.disconnect();
      xterm.dispose();
      xtermRef.current = null;
    };
  }, [sessionId]);

  if (!sessionId) {
    return <div className="terminal-empty"><p>No session selected. Click "+ New Session" to start.</p></div>;
  }

  return <div ref={containerRef} className="terminal-container" />;
}
