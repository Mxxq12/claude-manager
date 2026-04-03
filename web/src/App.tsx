import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './store/useStore';
import { useWebSocket } from './hooks/useWebSocket';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Session from './pages/Session';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useStore((s) => s.token);
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function ToastContainer() {
  const toasts = useStore((s) => s.toasts);
  const removeToast = useStore((s) => s.removeToast);
  if (toasts.length === 0) return null;
  return (
    <div className="toast-container">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.type}`} onClick={() => removeToast(t.id)}>
          {t.message}
        </div>
      ))}
    </div>
  );
}

function DisconnectBanner() {
  const wsConnected = useStore((s) => s.wsConnected);
  const token = useStore((s) => s.token);
  const [show, setShow] = useState(false);
  useEffect(() => {
    if (!token || wsConnected) { setShow(false); return; }
    const timer = setTimeout(() => setShow(true), 3000);
    return () => clearTimeout(timer);
  }, [token, wsConnected]);
  if (!show) return null;
  return (
    <div className="disconnect-banner">
      连接断开，正在重连...
    </div>
  );
}

export default function App() {
  useWebSocket();

  return (
    <BrowserRouter>
      <DisconnectBanner />
      <ToastContainer />
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/session/:id"
          element={
            <RequireAuth>
              <Session />
            </RequireAuth>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
