import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import path from 'path';

type SessionStatus = 'created' | 'starting' | 'idle' | 'busy' | 'error' | 'closed';
type IdleSubStatus = 'input' | 'approval';

interface UsageInfo {
  percent?: number;     // e.g. 84
  type?: string;        // e.g. "session", "weekly", "Opus"
  resetsAt?: string;    // e.g. "10pm (America/New_York)"
  warning?: boolean;    // approaching limit
  limited?: boolean;    // hit limit
}

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
  usage?: UsageInfo;
}

const MAX_BUFFER_BYTES = 2_000_000;
const BUFFER_CACHE_DIR = require('path').join(require('os').homedir(), '.claude', 'buffer-cache');

// Ensure buffer cache directory exists
try { require('fs').mkdirSync(BUFFER_CACHE_DIR, { recursive: true }); } catch {}

interface ManagedPair {
  controllerId: string;  // controller - Sonnet
  executorId: string;    // executor - Opus (original session)
  active: boolean;
  autoMode: boolean;     // true after [START_EXECUTION] detected
  lastTransferOutput: string;
  waitingForResponse: boolean; // true while waiting for the other side to respond (prevents loop)
}

export class SessionManager extends EventEmitter {
  private sessions = new Map<string, Session>();
  private hookServerPort: number = 0;
  private autoApproveGlobal: boolean = false;
  private autoApproveSessions = new Set<string>();
  private managedPairs = new Map<string, ManagedPair>();  // pairId -> pair

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
    this.emit('auto-approve-changed', { id, enabled });
  }

  isAutoApprove(id: string): boolean {
    return this.autoApproveGlobal || this.autoApproveSessions.has(id);
  }

  // --- Managed Mode (托管模式) ---

  startManagedForSession(executorId: string): { controllerId: string } | null {
    const executor = this.sessions.get(executorId);
    if (!executor) return null;

    // Create .managed folder if not exists
    const fs = require('fs');
    const managedDir = require('path').join(executor.cwd, '.managed');
    if (!fs.existsSync(managedDir)) fs.mkdirSync(managedDir, { recursive: true });

    // Create controller session in .managed dir (hidden, opus model)
    const controllerId = this.createSession(managedDir, true, 'opus');
    const controller = this.sessions.get(controllerId);
    if (controller) controller.name = `[控制] ${executor.name}`;

    // Enable auto-approve on both
    this.autoApproveSessions.add(controllerId);
    this.autoApproveSessions.add(executorId);

    const pairId = `managed-${executorId}`;
    const logFile = require('path').join(require('os').homedir(), '.claude', 'managed-debug.log');
    require('fs').appendFileSync(logFile, `[${new Date().toISOString()}] MANAGED PAIR: executor=${executorId.slice(0,8)} controller=${controllerId.slice(0,8)} pairId=${pairId}\n`);
    this.managedPairs.set(pairId, {
      controllerId,
      executorId,
      active: true,
      autoMode: false,
      lastTransferOutput: '',
      waitingForResponse: false,
    });

    // Send skill to controller after it's ready (always fresh, no resume)
    setTimeout(() => {
      const c = this.sessions.get(controllerId);
      if (c) {
        try {
          const skillPath = path.join(__dirname, '../assets/managed-controller-skill.md');
          const fs = require('fs');
          if (fs.existsSync(skillPath)) {
            const skill = fs.readFileSync(skillPath, 'utf-8');
            c.pty.write(`请阅读以下协作说明，这是 Claude Manager 的双会话协作功能：\n\n${skill}\n\n请确认理解，然后等待用户提出需求。\r`);
          }
        } catch (e) {
          console.error('[托管模式] Failed to load skill:', e);
        }
      }
    }, 5000);

    this.emit('managed-created', { pairId, controllerId, executorId });
    return { controllerId };
  }

  pauseManagedForSession(executorId: string): void {
    const pairId = `managed-${executorId}`;
    const pair = this.managedPairs.get(pairId);
    if (pair && pair.autoMode) {
      pair.autoMode = false;
      // Switch back to Opus for user interaction
      const c = this.sessions.get(pair.controllerId);
      if (c) c.pty.write('/model opus\r');
      console.log(`[托管模式] Pair ${pairId}: 暂停，控制者切回 Opus`);
      this.emit('managed-paused', { pairId });
    }
  }

  resumeManagedForSession(executorId: string): void {
    const pairId = `managed-${executorId}`;
    const pair = this.managedPairs.get(pairId);
    if (pair && pair.active && !pair.autoMode) {
      pair.autoMode = true;
      pair.waitingForResponse = false; // reset lock so controller can send next instruction
      console.log(`[托管模式] Pair ${pairId}: 恢复自动模式`);
      this.emit('managed-resumed', { pairId });
    }
  }

  isManagedAutoMode(executorId: string): boolean {
    const pairId = `managed-${executorId}`;
    return this.managedPairs.get(pairId)?.autoMode ?? false;
  }

  stopManagedForSession(executorId: string): void {
    const pairId = `managed-${executorId}`;
    const pair = this.managedPairs.get(pairId);
    if (!pair) return;
    const logFile = require('path').join(require('os').homedir(), '.claude', 'managed-debug.log');
    require('fs').appendFileSync(logFile, `[${new Date().toISOString()}] STOP MANAGED: executor=${executorId.slice(0,8)} stack=${new Error().stack?.split('\n').slice(1,4).join(' | ')}\n`);
    pair.active = false;
    // Close the controller session
    this.closeSession(pair.controllerId);
    this.managedPairs.delete(pairId);
    // Remove auto-approve that was added when managed mode started
    this.autoApproveSessions.delete(pair.controllerId);
    this.autoApproveSessions.delete(executorId);
    this.emit('managed-stopped', { pairId, executorId });
  }

  getManagedPairForSession(sessionId: string): { pairId: string; pair: ManagedPair } | null {
    for (const [pairId, pair] of this.managedPairs) {
      if (pair.controllerId === sessionId || pair.executorId === sessionId) {
        return { pairId, pair };
      }
    }
    return null;
  }

  getManagedControllerIdForSession(executorId: string): string | null {
    const pairId = `managed-${executorId}`;
    return this.managedPairs.get(pairId)?.controllerId ?? null;
  }

  private handleManagedTransfer(id: string, status: 'idle' | 'busy', subStatus?: IdleSubStatus): void {
    if (status !== 'idle' || subStatus !== 'input') return;

    const managed = this.getManagedPairForSession(id);
    if (!managed || !managed.pair.active) return;

    const { pair, pairId } = managed;

    // Check for START_EXECUTION in recentOutput (before requesting extract)
    const session = this.sessions.get(id);
    if (session && id === pair.controllerId) {
      const raw = session.recentOutput;
      if (!pair.autoMode && /\[START_EXECUTION\]/i.test(raw)) {
        console.log(`[托管模式] Pair ${pairId}: 开始自动执行`);
        pair.autoMode = true;
        session.recentOutput = '';
        this.emit('managed-started', { pairId });
        setTimeout(() => {
          const c = this.sessions.get(pair.controllerId);
          if (c && pair.active && pair.autoMode) {
            c.pty.write('请输出给执行者的第一条具体任务指令。注意：你不能自己执行代码，只能输出文字指令。\r');
          }
        }, 1000);
        return;
      }
      if (/\[TASK_COMPLETE\]/i.test(raw)) {
        pair.active = false;
        pair.autoMode = false;
        pair.waitingForResponse = false;
        this.emit('managed-completed', { pairId });
        return;
      }
      if (/\[NEED_USER_INPUT\]/i.test(raw)) {
        pair.autoMode = false;
        pair.waitingForResponse = false;
        this.emit('managed-paused', { pairId });
        return;
      }
    }

    if (!pair.autoMode) return;

    // Request frontend to extract clean reply text from xterm buffer
    // Controller idle & not waiting → extract controller reply → send to executor
    // Executor idle & waiting → extract executor reply → send to controller
    if (id === pair.controllerId && !pair.waitingForResponse) {
      this.emit('request-extract-reply', { sessionId: id });
    } else if (id === pair.executorId && pair.waitingForResponse) {
      this.emit('request-extract-reply', { sessionId: id });
    }
  }

  // Called when frontend sends back extracted clean text
  handleExtractedReply(sessionId: string, text: string): void {
    const managed = this.getManagedPairForSession(sessionId);
    if (!managed || !managed.pair.active || !managed.pair.autoMode) return;

    const { pair, pairId } = managed;
    if (!text || text === pair.lastTransferOutput) return;
    pair.lastTransferOutput = text;

    const logFile = require('path').join(require('os').homedir(), '.claude', 'managed-debug.log');

    if (sessionId === pair.controllerId) {
      // Controller reply → send to executor
      const instruction = text.replace(/\[START_EXECUTION\]/gi, '').replace(/\[TASK_COMPLETE\]/gi, '').trim();
      if (!instruction) return;
      pair.waitingForResponse = true;
      require('fs').appendFileSync(logFile, `[${new Date().toISOString()}] SENDING TO EXECUTOR (${instruction.length}字):\n${instruction.slice(0, 500)}\n---\n`);
      setTimeout(() => {
        if (!pair.active || !pair.autoMode) return;
        const executor = this.sessions.get(pair.executorId);
        if (executor) {
          executor.pty.write(instruction + '\r');
          this.emit('managed-transfer', { pairId, from: 'controller', to: 'executor' });
        }
      }, 1000);
    } else if (sessionId === pair.executorId) {
      // Executor reply → send to controller
      pair.waitingForResponse = false;
      const truncated = text.length > 3000 ? '...' + text.slice(-3000) : text;
      require('fs').appendFileSync(logFile, `[${new Date().toISOString()}] SENDING TO CONTROLLER (${truncated.length}字):\n${truncated.slice(0, 500)}\n---\n`);
      setTimeout(() => {
        if (!pair.active || !pair.autoMode) return;
        const controller = this.sessions.get(pair.controllerId);
        if (controller) {
          const prompt = `执行者已完成，输出如下。请审查并给出下一步指令，或输出 [TASK_COMPLETE] 结束任务。\n\n${truncated}`;
          controller.pty.write(prompt + '\r');
          this.emit('managed-transfer', { pairId, from: 'executor', to: 'controller' });
        }
      }, 1000);
    }
  }

  private detectUsageInfo(id: string, session: Session): void {
    const output = session.recentOutput;

    // "You've used 84% of your session limit · resets 10pm (America/New_York)"
    const usageMatch = output.match(/You've used (\d+)% of your (\w+) limit[^·]*·\s*resets\s+([^"]+)/i);
    if (usageMatch) {
      session.usage = {
        percent: parseInt(usageMatch[1], 10),
        type: usageMatch[2],
        resetsAt: usageMatch[3].trim(),
        warning: true,
        limited: false,
      };
      this.emit('usage', { id, usage: session.usage });
      return;
    }

    // "You've hit your session limit · resets ..."
    const hitMatch = output.match(/You've hit your (\w+) limit[^·]*·\s*resets\s+([^"]+)/i);
    if (hitMatch) {
      session.usage = {
        percent: 100,
        type: hitMatch[1],
        resetsAt: hitMatch[2].trim(),
        warning: false,
        limited: true,
      };
      this.emit('usage', { id, usage: session.usage });
      return;
    }

    // Generic "You've hit your limit · resets ..."
    const genericHit = output.match(/You've hit your limit[^·]*·\s*resets\s+([^"]+)/i);
    if (genericHit) {
      session.usage = {
        percent: 100,
        type: 'usage',
        resetsAt: genericHit[1].trim(),
        warning: false,
        limited: true,
      };
      this.emit('usage', { id, usage: session.usage });
    }
  }

  getUsage(id: string): UsageInfo | undefined {
    return this.sessions.get(id)?.usage;
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
          s.pty.write('\r');
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

  createSession(cwd: string, hidden = false, model = 'opus', resume = false): string {
    const id = randomUUID();
    const name = path.basename(cwd);

    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      CLAUDE_MANAGER_PORT: String(this.hookServerPort),
      CLAUDE_MANAGER_SESSION_ID: id,
    };
    const logFile = require('path').join(require('os').homedir(), '.claude', 'managed-debug.log');
    require('fs').appendFileSync(logFile, `[${new Date().toISOString()}] CREATE SESSION: id=${id.slice(0,8)} cwd=${cwd} port=${this.hookServerPort} hidden=${hidden}\n`);

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

    // Spawn shell, then send claude command — exit claude returns to shell
    const shell = process.env.SHELL || '/bin/bash';
    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(shell, [], {
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
    // Export env vars so claude's hook subprocesses can access them, then launch claude
    // If resume requested, check if conversation history actually exists for this cwd
    let effectiveResume = resume;
    if (resume) {
      const cwdKey = cwd.replace(/\//g, '-');
      const projectDir = require('path').join(require('os').homedir(), '.claude', 'projects', cwdKey);
      if (!require('fs').existsSync(projectDir)) {
        effectiveResume = false;
      }
    }
    const resumeFlag = effectiveResume ? ' --continue' : '';
    ptyProcess.write(`export CLAUDE_MANAGER_PORT=${this.hookServerPort} CLAUDE_MANAGER_SESSION_ID=${id} && clear && ${claudePath} --dangerously-skip-permissions --permission-mode bypassPermissions${resumeFlag}\r`);

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

    // Clear buffer after startup command to avoid replaying launch commands
    setTimeout(() => {
      session.outputBuffer = [];
      session.bufferSize = 0;
    }, 2000);

    // Buffer cache file keyed by cwd (persists across restarts)
    const cwdHash = cwd.replace(/\//g, '-').replace(/^-/, '');
    const bufferCacheFile = require('path').join(BUFFER_CACHE_DIR, `${cwdHash}.buf`);

    ptyProcess.onData((rawData: string) => {
      // 剥掉 xterm.js v5 解析器会出 bug 的几类 CSI 序列：
      // 1. `\x1b[<u`、`\x1b[>1u` — kitty 键盘协议（xterm 不支持，剥掉无副作用）
      // 2. `\x1b[>4;2m` — xterm modify-keys 扩展
      // 3. `\x1b[?2026h`、`\x1b[?2026l` — 同步输出模式（atomic refresh hint），
      //    Claude CLI 在用量 90%+ 时高频切换它，xterm.js v5 处理不过来，
      //    会进入异常状态把后续 CSI 当字面文字渲染（[27m、[5A 满屏）。
      //    剥掉只是失去原子刷新优化，渲染本身正常。
      const data = rawData
        .replace(/\x1b\[[<>][0-9;]*[a-zA-Z]/g, '')
        .replace(/\x1b\[\?2026[hl]/g, '');
      const bytes = new TextEncoder().encode(data);
      session.outputBuffer.push(bytes);
      session.bufferSize += bytes.length;

      while (session.bufferSize > MAX_BUFFER_BYTES && session.outputBuffer.length > 1) {
        const removed = session.outputBuffer.shift()!;
        session.bufferSize -= removed.length;
      }

      // Persist to disk (append, truncate if too large)
      try {
        const fs = require('fs');
        fs.appendFileSync(bufferCacheFile, Buffer.from(bytes));
        const stat = fs.statSync(bufferCacheFile);
        if (stat.size > MAX_BUFFER_BYTES) {
          const buf = fs.readFileSync(bufferCacheFile);
          fs.writeFileSync(bufferCacheFile, buf.slice(-MAX_BUFFER_BYTES / 2));
        }
      } catch {}

      this.emit('data', { id, data: bytes });

      // Track recent output for auto-approve detection
      session.recentOutput += data;
      if (session.recentOutput.length > 2000) {
        session.recentOutput = session.recentOutput.slice(-2000);
      }

      // Auto-approve: detect permission prompts in terminal output
      if (this.isAutoApprove(id)) {
        // Detect common approval patterns from Claude CLI (simple Y/n prompts)
        if (/\(Y\)es/i.test(session.recentOutput) || /\[Y\/n\]/i.test(session.recentOutput) || /Do you want to proceed/i.test(session.recentOutput)) {
          session.recentOutput = '';
          setTimeout(() => {
            const s = this.sessions.get(id);
            if (s) s.pty.write('y');
          }, 200);
        }
        // Detect interactive numbered menus
        // Claude CLI 用光标定位渲染菜单，❯ 不会出现在文字流里，只匹配问题 + 编号选项
        if (/\d+\.\s*(Yes|Allow)/i.test(session.recentOutput) &&
            /(Do you want to|Would you like to)/i.test(session.recentOutput)) {
          session.recentOutput = '';
          setTimeout(() => {
            const s = this.sessions.get(id);
            if (s) s.pty.write('\r');
          }, 200);
        }
      }

      // Rate limit detection: always schedule auto-resume (regardless of auto-approve)
      this.detectRateLimitAndScheduleResume(id, session);

      // Usage monitoring: detect usage percentage and limit messages
      this.detectUsageInfo(id, session);
    });

    ptyProcess.onExit(({ exitCode }) => {
      const s = this.sessions.get(id);
      if (!s) return;
      s.status = exitCode === 0 ? 'closed' : 'error';
      s.statusTimestamp = Date.now();
      this.emit('closed', { id, exitCode });
    });

    this.sessions.set(id, session);
    if (!hidden) {
      this.emit('created', { id, name, cwd });
    }
    return id;
  }

  // Called by hook HTTP server
  setSessionStatus(id: string, status: 'idle' | 'busy', subStatus?: IdleSubStatus): void {
    const logFile = require('path').join(require('os').homedir(), '.claude', 'managed-debug.log');
    const managed = this.getManagedPairForSession(id);
    if (managed) {
      const role = id === managed.pair.controllerId ? 'controller' : 'executor';
      require('fs').appendFileSync(logFile, `[${new Date().toISOString()}] setSessionStatus: ${role} ${id.slice(0,8)} status=${status} sub=${subStatus} active=${managed.pair.active} autoMode=${managed.pair.autoMode} waiting=${managed.pair.waitingForResponse}\n`);
    }
    if (this.managedPairs.size > 0 && !managed) {
      const pairs = [...this.managedPairs.entries()].map(([k, v]) => `${k}: ctrl=${v.controllerId.slice(0,8)} exec=${v.executorId.slice(0,8)}`).join('; ');
      require('fs').appendFileSync(logFile, `[${new Date().toISOString()}] NO MATCH for ${id.slice(0,8)}, pairs: ${pairs}\n`);
    }
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

    // Managed mode: transfer output between paired sessions
    const managedPair = this.getManagedPairForSession(id);
    if (managedPair) {
      if (managedPair.pair.active) {
        this.handleManagedTransfer(id, status, subStatus);
      }
      return; // Always skip auto-continue for managed sessions (active or not)
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
    this.emit('closed', { id, exitCode: 0 });
    session.pty.kill();
    this.sessions.delete(id);
  }

  renameSession(id: string, name: string): void {
    const session = this.sessions.get(id);
    if (session) session.name = name;
  }

  getBuffer(id: string): Uint8Array[] {
    const session = this.sessions.get(id);
    if (!session) return [];

    // If memory buffer has data, use it
    if (session.outputBuffer.length > 0) return session.outputBuffer;

    // Try loading from disk cache
    try {
      const fs = require('fs');
      const cwdHash = session.cwd.replace(/\//g, '-').replace(/^-/, '');
      const cacheFile = require('path').join(BUFFER_CACHE_DIR, `${cwdHash}.buf`);
      if (fs.existsSync(cacheFile)) {
        const data = fs.readFileSync(cacheFile);
        if (data.length > 0) {
          const chunk = new Uint8Array(data);
          session.outputBuffer.push(chunk);
          session.bufferSize = chunk.length;
          return session.outputBuffer;
        }
      }
    } catch {}

    return [];
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
