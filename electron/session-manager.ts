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

  setHookServerPort(port: number) {
    this.hookServerPort = port;
  }

  createSession(cwd: string): string {
    const id = randomUUID();
    const name = path.basename(cwd);

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      CLAUDE_MANAGER_PORT: String(this.hookServerPort),
      CLAUDE_MANAGER_SESSION_ID: id,
    };

    const ptyProcess = pty.spawn('claude', ['--dangerously-skip-permissions', '--permission-mode', 'bypassPermissions'], {
      name: 'xterm-256color',
      cwd,
      cols: 120,
      rows: 30,
      env,
    });

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

    ptyProcess.onData((data: string) => {
      const bytes = new TextEncoder().encode(data);
      session.outputBuffer.push(bytes);
      session.bufferSize += bytes.length;

      while (session.bufferSize > MAX_BUFFER_BYTES && session.outputBuffer.length > 1) {
        const removed = session.outputBuffer.shift()!;
        session.bufferSize -= removed.length;
      }

      this.emit('data', { id, data: bytes });
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
    this.sessions.get(id)?.pty.resize(cols, rows);
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
