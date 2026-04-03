import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import type { SessionManager } from './session-manager';

// Persist JWT secret so tokens survive app restarts
const jwtSecretPath = path.join(require('os').homedir(), '.claude', 'claude-manager-jwt-secret');
const JWT_SECRET = (() => {
  try { return fs.readFileSync(jwtSecretPath, 'utf8'); } catch {}
  const secret = crypto.randomBytes(32).toString('hex');
  try { fs.writeFileSync(jwtSecretPath, secret); } catch {}
  return secret;
})();
const JWT_EXPIRY = '30d';

export async function startWebServer(sessionManager: SessionManager, port: number): Promise<http.Server> {
  // Auth setup
  const password = process.env.CLAUDE_REMOTE_PASSWORD || 'admin123';
  const passwordHash = bcrypt.hashSync(password, 10);

  const app = express();
  app.use(express.json());

  // CORS
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (_req.method === 'OPTIONS') { res.sendStatus(204); return; }
    next();
  });

  // --- REST API ---

  // Login
  app.post('/api/login', (req, res) => {
    const { password: pwd } = req.body || {};
    if (!pwd || !bcrypt.compareSync(pwd, passwordHash)) {
      res.status(401).json({ error: '密码错误' });
      return;
    }
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
    res.json({ token });
  });

  // JWT middleware
  const authMiddleware: express.RequestHandler = (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) { res.status(401).json({ error: '未认证' }); return; }
    try {
      jwt.verify(auth.slice(7), JWT_SECRET);
      next();
    } catch {
      res.status(401).json({ error: '未认证' });
    }
  };

  // Sessions
  app.get('/api/sessions', authMiddleware, (_req, res) => {
    const sessions = sessionManager.getAllSessions().map((s: any) => ({
      ...s,
      autoApprove: sessionManager.isAutoApprove(s.id),
    }));
    res.json(sessions);
  });

  app.post('/api/sessions', authMiddleware, (req, res) => {
    const { cwd, model, initialPrompt, resume } = req.body || {};
    if (!cwd) { res.status(400).json({ error: '缺少 cwd' }); return; }
    try {
      // Auto-create directory if it doesn't exist
      if (!fs.existsSync(cwd)) {
        fs.mkdirSync(cwd, { recursive: true });
      }
      const id = sessionManager.createSession(cwd, false, model || 'opus', !!resume);
      if (initialPrompt) {
        setTimeout(() => sessionManager.sendInput(id, initialPrompt + '\r'), 3000);
      }
      res.json({ id });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  // Recent projects from ~/.claude/projects
  app.get('/api/projects', authMiddleware, (_req, res) => {
    const projectsDir = path.join(require('os').homedir(), '.claude', 'projects');
    try {
      const entries = fs.readdirSync(projectsDir);
      const projects = entries
        .map((entry: string) => {
          const projectPath = '/' + entry.replace(/^-/, '').replace(/-/g, '/');
          try {
            if (!fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) return null;
            const stat = fs.statSync(path.join(projectsDir, entry));
            return { path: projectPath, name: path.basename(projectPath), mtime: stat.mtimeMs };
          } catch { return null; }
        })
        .filter(Boolean)
        .sort((a: any, b: any) => b.mtime - a.mtime);
      res.json(projects);
    } catch {
      res.json([]);
    }
  });

  app.delete('/api/sessions/:id', authMiddleware, (req, res) => {
    sessionManager.closeSession(req.params.id as string);
    res.json({ ok: true });
  });

  // Static files (production, no cache for development)
  const webDistPath = path.join(__dirname, '../web-dist');
  if (fs.existsSync(path.join(webDistPath, 'index.html'))) {
    app.use(express.static(webDistPath, { maxAge: 0, etag: false }));
    app.get('*', (req, res) => {
      if (req.path.startsWith('/api') || req.path.startsWith('/ws')) return;
      res.sendFile(path.join(webDistPath, 'index.html'));
    });
  }

  // --- HTTP + WebSocket Server ---

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const clients = new Set<WebSocket>();

  // Verify JWT on upgrade
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url || '/', `http://localhost`);
    if (!url.pathname.startsWith('/ws')) { socket.destroy(); return; }
    const token = url.searchParams.get('token');
    if (!token) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    try {
      jwt.verify(token, JWT_SECRET);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  function send(ws: WebSocket, type: string, payload?: any) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, payload }));
    }
  }

  function broadcast(type: string, payload?: any) {
    const msg = JSON.stringify({ type, payload });
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN) ws.send(msg);
    }
  }

  // Connection handler
  wss.on('connection', (ws) => {
    clients.add(ws);
    (ws as any).isAlive = true;

    // Send initial sync
    const sessions = sessionManager.getAllSessions().map((s: any) => ({
      ...s,
      autoApprove: sessionManager.isAutoApprove(s.id),
    }));
    send(ws, 'session.sync', sessions);

    ws.on('pong', () => { (ws as any).isAlive = true; });

    ws.on('message', (raw) => {
      let msg: { type: string; payload?: any };
      try { msg = JSON.parse(raw.toString()); } catch { return; }

      switch (msg.type) {
        case 'session.create': {
          const { cwd, model, initialPrompt } = msg.payload || {};
          if (!cwd) { send(ws, 'session.error', { message: '缺少 cwd' }); break; }
          const id = sessionManager.createSession(cwd, false, model || 'opus');
          if (initialPrompt) {
            setTimeout(() => sessionManager.sendInput(id, initialPrompt + '\r'), 3000);
          }
          break;
        }
        case 'session.input': {
          const { sessionId, text } = msg.payload || {};
          if (sessionId) sessionManager.sendInput(sessionId, (text || '') + '\r');
          break;
        }
        case 'session.rawInput': {
          const { sessionId, data } = msg.payload || {};
          if (sessionId && data) sessionManager.sendInput(sessionId, data);
          break;
        }
        case 'session.approve': {
          const { sessionId } = msg.payload || {};
          if (sessionId) sessionManager.sendInput(sessionId, 'y');
          break;
        }
        case 'session.kill': {
          const { sessionId } = msg.payload || {};
          if (sessionId) sessionManager.closeSession(sessionId);
          break;
        }
        case 'session.resize': {
          const { sessionId, cols, rows } = msg.payload || {};
          if (sessionId && cols && rows) sessionManager.resizePty(sessionId, cols, rows);
          break;
        }
        case 'session.buffer': {
          const { sessionId } = msg.payload || {};
          if (sessionId) {
            const buffer = sessionManager.getBuffer(sessionId);
            // Limit to last ~500KB
            let totalSize = 0;
            const maxSize = 500_000;
            const limited: Uint8Array[] = [];
            for (let i = buffer.length - 1; i >= 0; i--) {
              totalSize += buffer[i].length;
              if (totalSize > maxSize) break;
              limited.unshift(buffer[i]);
            }
            send(ws, 'session.buffer', {
              sessionId,
              data: limited.map(b => Buffer.from(b).toString('base64')),
            });
          }
          break;
        }
        case 'session.autoApprove': {
          const { sessionId, enabled } = msg.payload || {};
          if (sessionId != null) {
            sessionManager.setAutoApproveSession(sessionId, !!enabled);
            // Broadcast to all clients so they stay in sync
            broadcast('session.autoApprove', { sessionId, enabled: !!enabled });
          }
          break;
        }
        case 'session.getAutoApprove': {
          const { sessionId } = msg.payload || {};
          if (sessionId) send(ws, 'session.autoApprove', { sessionId, enabled: sessionManager.isAutoApprove(sessionId) });
          break;
        }
        case 'managed.start': {
          const { sessionId } = msg.payload || {};
          if (sessionId) {
            const result = sessionManager.startManagedForSession(sessionId);
            if (result) send(ws, 'managed.started', { sessionId, controllerId: result.controllerId });
          }
          break;
        }
        case 'managed.stop': {
          const { sessionId } = msg.payload || {};
          if (sessionId) sessionManager.stopManagedForSession(sessionId);
          break;
        }
        case 'managed.pause': {
          const { sessionId } = msg.payload || {};
          if (sessionId) sessionManager.pauseManagedForSession(sessionId);
          break;
        }
        case 'managed.resume': {
          const { sessionId } = msg.payload || {};
          if (sessionId) sessionManager.resumeManagedForSession(sessionId);
          break;
        }
        case 'ping':
          send(ws, 'pong');
          break;
      }
    });

    ws.on('close', () => { clients.delete(ws); });
    ws.on('error', () => { clients.delete(ws); });
  });

  // Heartbeat
  const heartbeat = setInterval(() => {
    for (const ws of clients) {
      if (!(ws as any).isAlive) { ws.terminate(); clients.delete(ws); continue; }
      (ws as any).isAlive = false;
      ws.ping();
    }
  }, 30000);
  wss.on('close', () => clearInterval(heartbeat));

  // --- SessionManager events → broadcast ---

  sessionManager.on('created', (payload: { id: string; cwd: string; name: string }) => {
    broadcast('session.created', { id: payload.id, cwd: payload.cwd, name: payload.name, status: 'idle' });
  });

  sessionManager.on('data', (payload: { id: string; data: Uint8Array }) => {
    broadcast('session.output', { sessionId: payload.id, data: Buffer.from(payload.data).toString('base64') });
  });

  sessionManager.on('status', (payload: { id: string; status: string; idleSubStatus?: string }) => {
    broadcast('session.status', { sessionId: payload.id, status: payload.status, idleSubStatus: payload.idleSubStatus });
  });

  sessionManager.on('closed', (payload: { id: string }) => {
    broadcast('session.status', { sessionId: payload.id, status: 'closed' });
  });

  sessionManager.on('managed-created', (payload: { pairId: string; controllerId: string; executorId: string }) => {
    broadcast('managed.created', payload);
  });
  sessionManager.on('managed-stopped', (payload: { pairId: string; executorId: string }) => {
    broadcast('managed.stopped', payload);
  });
  sessionManager.on('managed-started', (payload: { pairId: string }) => {
    broadcast('managed.autoStarted', payload);
  });
  sessionManager.on('managed-paused', (payload: { pairId: string }) => {
    broadcast('managed.paused', payload);
  });
  sessionManager.on('managed-completed', (payload: { pairId: string }) => {
    broadcast('managed.completed', payload);
  });

  // Start listening
  return new Promise((resolve) => {
    server.listen(port, '0.0.0.0', () => {
      console.log(`[web-remote] 服务启动于 http://localhost:${port}`);
      resolve(server);
    });
  });
}
