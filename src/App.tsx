import { useEffect, useState, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { Sidebar } from './components/Sidebar';
import { Terminal } from './components/Terminal';
import { StatusBar } from './components/StatusBar';
import { BrowserPreview } from './components/BrowserPreview';
import { useSessionStore } from './stores/session-store';
import { themes, applyTheme, loadSavedTheme } from './themes';
import type { Theme } from './themes';
import type { SessionStatus } from './types';
import './App.css';

// Error Boundary to catch React rendering errors
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('React Error Boundary caught an error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: 40, color: '#cdd6f4', background: '#1e1e2e', height: '100vh', fontFamily: 'sans-serif' }}>
          <h1 style={{ color: '#f38ba8' }}>应用出错了</h1>
          <p>发生了意外错误，请尝试重启应用。</p>
          <pre style={{ background: '#313244', padding: 16, borderRadius: 8, overflow: 'auto', maxHeight: 200 }}>
            {this.state.error?.message}
          </pre>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ marginTop: 16, padding: '8px 16px', background: '#89b4fa', color: '#1e1e2e', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            重试
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

const statusOrder: Record<SessionStatus, number> = {
  idle: 0, error: 1, busy: 2, starting: 3, created: 4, closed: 5,
};

function getSorted() {
  const sessions = useSessionStore.getState().sessions;
  return [...sessions].sort((a, b) => {
    const diff = statusOrder[a.status] - statusOrder[b.status];
    if (diff !== 0) return diff;
    return b.statusTimestamp - a.statusTimestamp;
  });
}

function FirstRunModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="firstrun-overlay">
      <div className="firstrun-modal">
        <div className="firstrun-header">Claude Manager</div>
        <div className="firstrun-body">
          <section className="firstrun-section">
            <h3>快捷键</h3>
            <table className="firstrun-shortcuts">
              <tbody>
                <tr><td><kbd>Cmd+N</kbd></td><td>新建会话</td></tr>
                <tr><td><kbd>Cmd+W</kbd></td><td>关闭当前会话</td></tr>
                <tr><td><kbd>Cmd+1-9</kbd></td><td>切换到第 N 个会话</td></tr>
                <tr><td><kbd>Cmd+[</kbd> / <kbd>Cmd+]</kbd></td><td>切换上/下一个会话</td></tr>
                <tr><td><kbd>Cmd+</kbd> / <kbd>Cmd-</kbd></td><td>调整终端字体大小</td></tr>
              </tbody>
            </table>
          </section>
          <section className="firstrun-section">
            <h3>功能</h3>
            <ul>
              <li>右键菜单：会话卡片可重命名，终端区域可清屏</li>
              <li>拖拽文件夹到侧边栏快速创建会话</li>
              <li>分屏模式同时查看两个会话</li>
              <li>14 种配色主题可选</li>
              <li>批量命令同时发送到多个会话</li>
            </ul>
          </section>
          <section className="firstrun-section firstrun-warning">
            <h3>安全提示</h3>
            <ul>
              <li>所有会话均以 <code>--dangerously-skip-permissions</code> 模式启动，Claude 将跳过权限确认直接执行操作。</li>
              <li>应用会修改 <code>~/.claude/settings.json</code> 注入 hooks，用于检测会话状态（忙碌/空闲/等待确认）。</li>
              <li>请仅在信任的项目中使用本工具。</li>
            </ul>
          </section>
        </div>
        <div className="firstrun-footer">
          <button className="firstrun-btn" onClick={onClose}>开始使用</button>
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [showFirstRun, setShowFirstRun] = useState(() => !localStorage.getItem('claude-manager-security-acknowledged'));
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null;

  const [currentTheme, setCurrentTheme] = useState<Theme>(loadSavedTheme);
  const [splitView, setSplitView] = useState(false);
  const [rightSessionId, setRightSessionId] = useState<string | null>(null);
  const [rightPaneMode, setRightPaneMode] = useState<'session' | 'browser'>('session');
  const rightSession = sessions.find((s) => s.id === rightSessionId) ?? null;

  const addSession = useSessionStore((s) => s.addSession);
  const updateStatus = useSessionStore((s) => s.updateStatus);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const setExitCode = useSessionStore((s) => s.setExitCode);
  const updateUsage = useSessionStore((s) => s.updateUsage);

  useEffect(() => { applyTheme(currentTheme); }, [currentTheme]);

  const handleThemeChange = (name: string) => {
    const t = themes.find((th) => th.name === name) || themes[0];
    setCurrentTheme(t);
    applyTheme(t);
  };

  // When toggling split, auto-pick the right pane session
  const handleToggleSplit = () => {
    if (!splitView) {
      // Find a session different from active
      const other = sessions.find((s) => s.id !== activeSessionId);
      setRightSessionId(other?.id ?? null);
    }
    setSplitView((v) => !v);
  };

  // Update window title
  useEffect(() => {
    if (!window.electronAPI?.setWindowTitle) return;
    if (splitView && activeSession && rightSession) {
      window.electronAPI.setWindowTitle(`${activeSession.name} | ${rightSession.name} - Claude Manager`);
    } else if (activeSession) {
      window.electronAPI.setWindowTitle(`${activeSession.name} - Claude Manager`);
    } else {
      window.electronAPI.setWindowTitle('Claude Manager');
    }
  }, [activeSession?.name, activeSessionId, rightSession?.name, rightSessionId, splitView]);

  useEffect(() => {
    if (!window.electronAPI) return;
    const offCreated = window.electronAPI.onSessionCreated((p) => addSession(p.id, p.name, p.cwd));
    const offStatus = window.electronAPI.onSessionStatus((p) => updateStatus(p.id, p.status, p.idleSubStatus, p.timestamp));
    const offClosed = window.electronAPI.onSessionClosed((p) => {
      updateStatus(p.id, p.exitCode === 0 ? 'closed' : 'error', undefined, Date.now());
      setExitCode(p.id, p.exitCode);
    });
    const offSwitch = window.electronAPI.onSwitchTo?.((id) => {
      setActiveSession(id);
    });
    const offRename = window.electronAPI.onRenameRequest?.((id) => {
      window.dispatchEvent(new CustomEvent('session:start-rename', { detail: id }));
    });
    const offUsage = window.electronAPI.onUsageUpdate?.((p) => {
      updateUsage(p.id, p.usage);
    });
    return () => { offCreated(); offStatus(); offClosed(); offSwitch?.(); offRename?.(); offUsage?.(); };
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!window.electronAPI) return;
      if (e.metaKey && e.key === 'n') {
        e.preventDefault();
        window.electronAPI.selectDirectory().then((cwd) => { if (cwd) window.electronAPI.createSession(cwd); });
      }
      if (e.metaKey && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const sorted = getSorted();
        const idx = parseInt(e.key) - 1;
        if (sorted[idx]) setActiveSession(sorted[idx].id);
      }
      if (e.metaKey && e.key === 'w') {
        e.preventDefault();
        if (activeSessionId) {
          window.electronAPI.closeSession(activeSessionId);
          useSessionStore.getState().removeSession(activeSessionId);
        }
      }
      if (e.metaKey && e.key === '[') {
        e.preventDefault();
        const sorted = getSorted();
        const idx = sorted.findIndex((s) => s.id === activeSessionId);
        if (idx > 0) setActiveSession(sorted[idx - 1].id);
      }
      if (e.metaKey && e.key === ']') {
        e.preventDefault();
        const sorted = getSorted();
        const idx = sorted.findIndex((s) => s.id === activeSessionId);
        if (idx < sorted.length - 1) setActiveSession(sorted[idx + 1].id);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeSessionId]);

  // Clean up right pane if session removed
  useEffect(() => {
    if (rightSessionId && !sessions.find((s) => s.id === rightSessionId)) {
      setRightSessionId(null);
    }
  }, [sessions, rightSessionId]);

  // Close split if less than 2 sessions
  useEffect(() => {
    if (splitView && sessions.length < 2) {
      setSplitView(false);
    }
  }, [sessions.length, splitView]);

  return (
    <ErrorBoundary>
    {showFirstRun && (
      <FirstRunModal onClose={() => {
        localStorage.setItem('claude-manager-security-acknowledged', '1');
        setShowFirstRun(false);
      }} />
    )}
    <div className="app">
      <div className="titlebar-drag">Claude Manager</div>
      <Sidebar
        splitView={splitView}
        onToggleSplit={handleToggleSplit}
        currentTheme={currentTheme.name}
        onThemeChange={handleThemeChange}
      />
      <div className={`main-panels ${splitView ? 'split' : ''}`}>
        <main className="main-area">
          <Terminal sessionId={activeSessionId} theme={currentTheme} />

          <StatusBar session={activeSession} />
        </main>
        {splitView && (
          <main className="main-area right-pane">
            <div className="right-pane-selector">
              <select
                className="right-pane-select"
                style={{ width: 'auto', marginRight: 4 }}
                value={rightPaneMode}
                onChange={(e) => setRightPaneMode(e.target.value as 'session' | 'browser')}
              >
                <option value="session">会话</option>
                <option value="browser">浏览器</option>
              </select>
              {rightPaneMode === 'session' && (
                <select
                  className="right-pane-select"
                  value={rightSessionId ?? ''}
                  onChange={(e) => setRightSessionId(e.target.value || null)}
                >
                  <option value="">-- 选择会话 --</option>
                  {sessions
                    .filter((s) => s.id !== activeSessionId)
                    .map((s) => (
                      <option key={s.id} value={s.id}>{s.name} - {s.cwd}</option>
                    ))}
                </select>
              )}
            </div>
            {rightPaneMode === 'session' ? (
              <>
                <Terminal sessionId={rightSessionId} />
                <StatusBar session={rightSession} />
              </>
            ) : (
              <BrowserPreview />
            )}
          </main>
        )}
      </div>
    </div>
    </ErrorBoundary>
  );
}
