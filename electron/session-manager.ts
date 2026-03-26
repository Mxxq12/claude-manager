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
  recentOutput: string;
  rateLimitTimer?: ReturnType<typeof setTimeout>;
}

const MAX_BUFFER_BYTES = 2_000_000;

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

  private detectRateLimitAndScheduleResume(id: string, session: Session): void {
    // Match: "You've hit your ... · resets 10pm (America/New_York)"
    // or "You're out of extra usage · resets ..."
    const rateLimitMatch = session.recentOutput.match(
      /(?:You've hit your|You're out of extra usage)[^·]*·\s*resets\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*\(([^)]+)\)/i
    );
    if (!rateLimitMatch) return;

    // Clear any existing timer for this session
    if (session.rateLimitTimer) {
      clearTimeout(session.rateLimitTimer);
      session.rateLimitTimer = undefined;
    }

    const timeStr = rateLimitMatch[1]; // e.g. "10pm" or "2:30am"
    const timezone = rateLimitMatch[2]; // e.g. "America/New_York"

    try {
      // Parse the reset time
      const now = new Date();
      const match = timeStr.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
      if (!match) return;

      let hours = parseInt(match[1], 10);
      const minutes = parseInt(match[2] || '0', 10);
      const ampm = match[3].toLowerCase();

      if (ampm === 'pm' && hours !== 12) hours += 12;
      if (ampm === 'am' && hours === 12) hours = 0;

      // Build reset date in the specified timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const parts = formatter.formatToParts(now);
      const nowHour = parseInt(parts.find(p => p.type === 'hour')!.value, 10);
      const nowMinute = parseInt(parts.find(p => p.type === 'minute')!.value, 10);

      // Calculate delay in ms
      let delayMinutes = (hours * 60 + minutes) - (nowHour * 60 + nowMinute);
      if (delayMinutes <= 0) delayMinutes += 24 * 60; // next day

      const delayMs = delayMinutes * 60 * 1000 + 30_000; // add 30s buffer

      const resumeTime = new Date(now.getTime() + delayMs);
      console.log(`[AutoResume] Session ${session.name}: rate limit detected, will resume at ${resumeTime.toLocaleTimeString()} (in ${Math.round(delayMs / 60000)} min)`);

      this.emit('status', {
        id,
        status: session.status,
        idleSubStatus: session.idleSubStatus,
        timestamp: session.statusTimestamp,
        rateLimitResumeAt: resumeTime.getTime(),
      });

      session.rateLimitTimer = setTimeout(() => {
        const s = this.sessions.get(id);
        if (s) {
          console.log(`[AutoResume] Session ${s.name}: resuming after rate limit`);
          s.pty.write('/resume\r');
          session.rateLimitTimer = undefined;
          session.recentOutput = '';
        }
      }, delayMs);
    } catch (e) {
      console.error('[AutoResume] Failed to parse rate limit time:', e);
    }
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

    const shell = process.env.SHELL || (process.platform === 'win32' ? 'powershell.exe' : '/bin/bash');
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
      recentOutput: '',
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

      // Track recent output for auto-approve detection
      session.recentOutput += data;
      if (session.recentOutput.length > 2000) {
        session.recentOutput = session.recentOutput.slice(-2000);
      }

      // Auto-approve: detect permission prompts in terminal output
      if (this.isAutoApprove(id)) {
        // Detect common approval patterns from Claude CLI
        if (/\(Y\)es/i.test(session.recentOutput) || /\[Y\/n\]/i.test(session.recentOutput) || /Do you want to proceed/i.test(session.recentOutput)) {
          session.recentOutput = '';
          setTimeout(() => {
            const s = this.sessions.get(id);
            if (s) s.pty.write('y');
          }, 200);
        }
        // Detect sandbox permission prompts (network/filesystem interactive menu)
        if (/Do you want to allow/i.test(session.recentOutput) && /❯\s*1\.\s*Yes/i.test(session.recentOutput)) {
          session.recentOutput = '';
          setTimeout(() => {
            const s = this.sessions.get(id);
            if (s) s.pty.write('\r');
          }, 200);
        }
      }

      // Rate limit detection: always schedule auto-resume (regardless of auto-approve)
      this.detectRateLimitAndScheduleResume(id, session);
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

    // Auto-continue: when Claude stops to ask a question mid-task, auto-send continue
    if (status === 'idle' && subStatus === 'input' && this.isAutoApprove(id)) {
      const questionPatterns = [
        /[?\uFF1F]\s*$/m,    // ends with ? or ？(full-width)
        /要我/,              // 要我...吗
        /是否/,              // 是否
        /要不要/,            // 要不要
        /你觉得/,            // 你觉得
        /你看/,              // 你看行不行
        /可以吗/,            // 可以吗
        /行吗/,              // 行吗
        /好吗/,              // 好吗
        /确认/,              // 确认
        /怎么样/,            // 怎么样
        /如何/,              // 如何
        /没问题/,            // 没问题的话我就...
        /有没有要/,          // 有没有要调的
        /需要调整/,          // 需要调整吗
        /开干/,              // 我出设计文档然后开干
        /开始吧/,            // 开始吧
        /哪种/,              // 选哪种
        /which/i,            // which approach
        /should I/i,         // should I
        /shall I/i,          // shall I
        /do you want/i,      // do you want
        /would you like/i,   // would you like
        /what do you think/i, // what do you think
        /let me know/i,      // let me know
        /sound good/i,       // does that sound good
        /proceed/i,          // shall we proceed
        /approve/i,          // do you approve
        /go ahead/i,         // should I go ahead
        /ready to/i,         // ready to start
        /look good/i,        // does this look good
        /thoughts/i,         // any thoughts
      ];

      const output = session.recentOutput;
      const hasQuestion = questionPatterns.some((p) => p.test(output));

      if (hasQuestion) {
        session.recentOutput = '';
        setTimeout(() => {
          const s = this.sessions.get(id);
          if (s && s.status === 'idle' && s.idleSubStatus === 'input') {
            s.pty.write('继续，按你的方案执行\r');
          }
        }, 500);
      }
    }
  }

  sendInput(id: string, data: string): void {
    this.sessions.get(id)?.pty.write(data);
  }

  closeSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (session.rateLimitTimer) clearTimeout(session.rateLimitTimer);
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

  clearBuffer(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.outputBuffer = [];
      session.bufferSize = 0;
    }
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

  dispose(): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const session of this.sessions.values()) {
      if (session.rateLimitTimer) clearTimeout(session.rateLimitTimer);
      promises.push(new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          try { session.pty.kill('SIGKILL'); } catch {}
          resolve();
        }, 3000);
        session.pty.onExit(() => {
          clearTimeout(timeout);
          resolve();
        });
        try { session.pty.kill(); } catch { clearTimeout(timeout); resolve(); }
      }));
    }
    this.sessions.clear();
    return Promise.all(promises).then(() => {});
  }
}
