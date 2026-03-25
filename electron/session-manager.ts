import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import path from 'path';

type SessionStatus = 'created' | 'starting' | 'idle' | 'busy' | 'error' | 'closed';
type IdleSubStatus = 'input' | 'approval';

interface Session {
  id: string;
  name: string;
  cwd: string;
  pty: pty.IPty;
  status: SessionStatus;
  idleSubStatus?: IdleSubStatus;
  statusTimestamp: number;
  outputBuffer: Uint8Array[];
  bufferSize: number;
}

const MAX_BUFFER_BYTES = 5_000_000;

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, Session>();
  private hookServerPort: number = 0;
  private autoApproveGlobal: boolean = false;
  private autoApproveSessions = new Set<string>();

  setAutoApproveGlobal(enabled: boolean) {
    this.autoApproveGlobal = enabled;
  }

  getAutoApproveGlobal(): boolean {
    return this.autoApproveGlobal;
  }

  setAutoApproveSession(id: string, enabled: boolean) {
    if (enabled) {
      this.autoApproveSessions.add(id);
    } else {
      this.autoApproveSessions.delete(id);
    }
  }

  isAutoApprove(id: string): boolean {
    return this.autoApproveGlobal || this.autoApproveSessions.has(id);
  }

  setHookServerPort(port: number) {
    this.hookServerPort = port;
  }

  getSessionIdForCwd(cwd: string): string | null {
    for (const session of this.sessions.values()) {
      if (session.cwd === cwd && session.status !== 'closed') return session.id;
    }
    return null;
  }

  createSession(cwd: string): string {
    const id = randomUUID();
    const name = path.basename(cwd);

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      CLAUDE_MANAGER_PORT: String(this.hookServerPort),
      CLAUDE_MANAGER_SESSION_ID: id,
    };

    // Resolve claude path - needed when launched from Finder where PATH is limited
    const claudePath = (() => {
      const fs = require('fs');
      const { execSync } = require('child_process');
      const home = process.env.HOME || require('os').homedir();
      const candidates = [
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
        `${home}/.npm-global/bin/claude`,
        `${home}/.nvm/versions/node/current/bin/claude`,
        '/opt/local/bin/claude',
      ];
      for (const c of candidates) {
        try { if (fs.existsSync(c)) return c; } catch {}
      }
      // Fallback: try `which claude`
      try {
        const resolved = execSync('which claude', { encoding: 'utf8', timeout: 3000 }).trim();
        if (resolved && fs.existsSync(resolved)) return resolved;
      } catch {}
      return 'claude';
    })();

    const shell = process.env.SHELL || '/bin/zsh';
    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(shell, ['-l'], {
        name: 'xterm-256color',
        cwd,
        cols: 120,
        rows: 30,
        env,
      });
    } catch (err) {
      this.emit('error', { id, message: `PTY 启动失败: ${(err as Error).message}` });
      throw err;
    }

    // Launch claude inside the shell, clear the command from terminal history/display
    ptyProcess.write(`clear && ${claudePath} --dangerously-skip-permissions --permission-mode bypassPermissions\r`);

    const session: Session = {
      id,
      name,
      cwd,
      pty: ptyProcess,
      status: 'idle',
      statusTimestamp: Date.now(),
      outputBuffer: [],
      bufferSize: 0,
    };

    let recentOutput = '';

    ptyProcess.onData((data: string) => {
      const bytes = new TextEncoder().encode(data);
      session.outputBuffer.push(bytes);
      session.bufferSize += bytes.length;

      while (session.bufferSize > MAX_BUFFER_BYTES && session.outputBuffer.length > 1) {
        const removed = session.outputBuffer.shift()!;
        session.bufferSize -= removed.length;
      }

      this.emit('data', { id, data: bytes });

      // Auto-approve: detect permission prompts in terminal output
      if (this.isAutoApprove(id)) {
        recentOutput += data;
        // Keep only last 500 chars to avoid memory buildup
        if (recentOutput.length > 500) {
          recentOutput = recentOutput.slice(-500);
        }
        // Detect common approval patterns from Claude CLI
        if (/\(Y\)es/i.test(recentOutput) || /\[Y\/n\]/i.test(recentOutput) || /Do you want to proceed/i.test(recentOutput)) {
          recentOutput = '';
          setTimeout(() => {
            const s = this.sessions.get(id);
            if (s) s.pty.write('y');
          }, 200);
        }
        // Detect sandbox permission prompts (network/filesystem interactive menu)
        if (/Do you want to allow/i.test(recentOutput) && /❯\s*1\.\s*Yes/i.test(recentOutput)) {
          recentOutput = '';
          setTimeout(() => {
            const s = this.sessions.get(id);
            if (s) s.pty.write('\r');
          }, 200);
        }
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      const s = this.sessions.get(id);
      if (!s) return;
      s.status = exitCode === 0 ? 'closed' : 'error';
      s.statusTimestamp = Date.now();
      this.emit('closed', { id, exitCode });
    });

    this.sessions.set(id, session);
    this.emit('created', { id, name, cwd });
    return id;
  }

  // Called by hook HTTP server
  setSessionStatus(id: string, status: 'idle' | 'busy', subStatus?: IdleSubStatus): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.status === status && session.idleSubStatus === subStatus) return;

    session.status = status;
    session.idleSubStatus = subStatus;
    session.statusTimestamp = Date.now();

    this.emit('status', {
      id,
      status,
      idleSubStatus: subStatus,
      timestamp: session.statusTimestamp,
    });

    // Auto-approve: when approval is requested and auto-approve is on, send 'y'
    if (status === 'idle' && subStatus === 'approval' && this.isAutoApprove(id)) {
      setTimeout(() => {
        const s = this.sessions.get(id);
        if (s && s.status === 'idle' && s.idleSubStatus === 'approval') {
          s.pty.write('y');
        }
      }, 300);
    }
  }

  sendInput(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data);
  }

  closeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.pty.kill();
    this.sessions.delete(id);
  }

  renameSession(id: string, name: string): void {
    const session = this.sessions.get(id);
    if (session) session.name = name;
  }

  getBuffer(id: string): Uint8Array[] {
    return this.sessions.get(id)?.outputBuffer ?? [];
  }

  resizePty(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (!session) return;
    try {
      session.pty.resize(cols, rows);
    } catch (_) {
      // pty already closed
    }
  }

  getSession(id: string) {
    const s = this.sessions.get(id);
    if (!s) return null;
    return { id: s.id, name: s.name, cwd: s.cwd, status: s.status, idleSubStatus: s.idleSubStatus, statusTimestamp: s.statusTimestamp };
  }

  getAllSessions() {
    return Array.from(this.sessions.values()).map(s => ({
      id: s.id, name: s.name, cwd: s.cwd, status: s.status, idleSubStatus: s.idleSubStatus, statusTimestamp: s.statusTimestamp,
    }));
  }

  dispose(): void {
    for (const session of this.sessions.values()) {
      session.pty.kill();
    }
    this.sessions.clear();
  }
}
