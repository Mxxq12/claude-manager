import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import path from 'path';
import { StatusDetector } from './status-detector';
import type { SessionStatus, IdleSubStatus } from '../src/types';

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
  statusDetector: StatusDetector;
}

const MAX_BUFFER_BYTES = 5_000_000;

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, Session>();

  createSession(cwd: string): string {
    const id = randomUUID();
    const name = path.basename(cwd);

    const ptyProcess = pty.spawn('claude', [], {
      name: 'xterm-256color',
      cwd,
      cols: 120,
      rows: 30,
      env: { ...process.env } as Record<string, string>,
    });

    const statusDetector = new StatusDetector((status, subStatus) => {
      const session = this.sessions.get(id);
      if (!session) return;

      const newStatus: SessionStatus = status === 'busy' ? 'busy' : 'idle';
      if (session.status === newStatus && session.idleSubStatus === subStatus) return;

      session.status = newStatus;
      session.idleSubStatus = subStatus;
      session.statusTimestamp = Date.now();

      this.emit('status', {
        id,
        status: newStatus,
        idleSubStatus: subStatus,
        timestamp: session.statusTimestamp,
      });
    });

    const session: Session = {
      id,
      name,
      cwd,
      pty: ptyProcess,
      status: 'starting',
      statusTimestamp: Date.now(),
      outputBuffer: [],
      bufferSize: 0,
      statusDetector,
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
      statusDetector.onData(data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      const s = this.sessions.get(id);
      if (!s) return;
      s.status = exitCode === 0 ? 'closed' : 'error';
      s.statusTimestamp = Date.now();
      s.statusDetector.dispose();
      this.emit('closed', { id, exitCode });
    });

    this.sessions.set(id, session);
    this.emit('created', { id, name, cwd });
    return id;
  }

  sendInput(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data);
  }

  closeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.statusDetector.dispose();
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
      session.statusDetector.dispose();
      session.pty.kill();
    }
    this.sessions.clear();
  }
}
