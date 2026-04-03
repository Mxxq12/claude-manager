import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import type { Session } from '../store/useStore';

// ---------- 模块级单例 ----------
let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
let currentToken: string | null = null;
let pingInterval: ReturnType<typeof setInterval> | null = null;

// session.output 监听器：sessionId → Set<callback>
type OutputListener = (data: string) => void;
const outputListeners = new Map<string, Set<OutputListener>>();

// session.buffer 监听器
type BufferListener = (chunks: string[]) => void;
const bufferListeners = new Map<string, Set<BufferListener>>();

export function addOutputListener(sessionId: string, fn: OutputListener) {
  if (!outputListeners.has(sessionId)) {
    outputListeners.set(sessionId, new Set());
  }
  outputListeners.get(sessionId)!.add(fn);
  return () => {
    outputListeners.get(sessionId)?.delete(fn);
  };
}

export function addBufferListener(sessionId: string, fn: BufferListener) {
  if (!bufferListeners.has(sessionId)) {
    bufferListeners.set(sessionId, new Set());
  }
  bufferListeners.get(sessionId)!.add(fn);
  return () => {
    bufferListeners.get(sessionId)?.delete(fn);
  };
}

export function wsSend(msg: Record<string, unknown>) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function connect(token: string) {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;
  const url = `${protocol}//${host}/ws?token=${encodeURIComponent(token)}`;

  ws = new WebSocket(url);

  ws.onopen = () => {
    reconnectDelay = 1000;
    useStore.getState().setWsConnected(true);

    // 心跳
    if (pingInterval) clearInterval(pingInterval);
    pingInterval = setInterval(() => {
      wsSend({ type: 'ping' });
    }, 25000);
  };

  ws.onclose = () => {
    useStore.getState().setWsConnected(false);
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }
    scheduleReconnect(token);
  };

  ws.onerror = () => {
    ws?.close();
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch {
      // ignore
    }
  };
}

function scheduleReconnect(token: string) {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect(token);
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, 30000);
}

function handleMessage(msg: { type: string; payload?: any; [key: string]: unknown }) {
  const store = useStore.getState();
  const p = msg.payload;

  switch (msg.type) {
    case 'session.sync': {
      if (Array.isArray(p)) {
        store.setSessions(p as Session[]);
        // Sync autoApprove states
        for (const s of p) {
          if ((s as any).autoApprove) store.setAutoApprove((s as any).id, true);
        }
      }
      break;
    }

    case 'session.output': {
      const sessionId = p?.sessionId as string;
      const data = p?.data as string; // base64
      if (sessionId && data) {
        const listeners = outputListeners.get(sessionId);
        if (listeners) listeners.forEach((fn) => fn(data));
      }
      break;
    }

    case 'session.buffer': {
      const sessionId = p?.sessionId as string;
      const chunks = p?.data as string[]; // base64 数组
      if (sessionId && chunks) {
        const listeners = bufferListeners.get(sessionId);
        if (listeners) listeners.forEach((fn) => fn(chunks));
      }
      break;
    }

    case 'session.status': {
      const sessionId = p?.sessionId as string;
      const status = p?.status as Session['status'];
      if (sessionId && status) {
        if (status === 'closed') {
          store.removeSession(sessionId);
        } else {
          store.updateStatus(sessionId, status, p?.idleSubStatus);
          // Browser push notification when page is hidden
          if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
            const session = store.sessions.get(sessionId);
            const name = session?.name || sessionId.slice(0, 8);
            if (status === 'idle' && p?.idleSubStatus === 'approval') {
              new Notification('Claude Manager', { body: `${name} 需要审批`, tag: `approval-${sessionId}` });
            } else if (status === 'idle' && !p?.idleSubStatus) {
              new Notification('Claude Manager', { body: `${name} 已空闲`, tag: `idle-${sessionId}` });
            }
          }
        }
      }
      break;
    }

    case 'session.created': {
      if (p) store.addSession(p as Session);
      break;
    }

    case 'session.autoApprove': {
      if (p?.sessionId != null) store.setAutoApprove(p.sessionId, !!p.enabled);
      break;
    }

    case 'managed.created': {
      if (p?.executorId && p?.controllerId) store.setManaged(p.executorId, p.controllerId);
      break;
    }
    case 'managed.stopped':
    case 'managed.completed': {
      if (p?.executorId) store.setManaged(p.executorId, null);
      else if (p?.pairId) {
        const execId = p.pairId.replace('managed-', '');
        store.setManaged(execId, null);
      }
      break;
    }

    default:
      break;
  }
}

function disconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
  if (ws) {
    ws.onclose = null;
    ws.close();
    ws = null;
  }
  useStore.getState().setWsConnected(false);
}

/**
 * 在 App 顶层调用一次即可。
 * token 变化时自动重连；token 为 null 时断开。
 */
export function useWebSocket() {
  const token = useStore((s) => s.token);
  const tokenRef = useRef(token);
  tokenRef.current = token;

  useEffect(() => {
    if (!token) {
      disconnect();
      currentToken = null;
      return;
    }

    if (token !== currentToken) {
      disconnect();
      currentToken = token;
      connect(token);
    }

    // 不在卸载时断开 —— 模块级单例
  }, [token]);
}
