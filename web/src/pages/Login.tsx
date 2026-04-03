import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';

export default function Login() {
  const [password, setPassword] = useState(() => localStorage.getItem('savedPassword') || '');
  const [rememberPwd, setRememberPwd] = useState(() => !!localStorage.getItem('savedPassword'));
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const setToken = useStore((s) => s.setToken);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password.trim() || loading) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `登录失败 (${res.status})`);
      }

      const { token } = await res.json();
      if (rememberPwd) {
        localStorage.setItem('savedPassword', password);
      } else {
        localStorage.removeItem('savedPassword');
      }
      setToken(token);
      navigate('/', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '网络错误');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="page login-page">
      <div className="login-logo">
        <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        </svg>
      </div>
      <h1>Claude Manager</h1>
      <p className="subtitle">远程控制台</p>

      <form className="login-form" onSubmit={handleSubmit}>
        <div className="input-wrapper">
          <span className="input-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </span>
          <input
            type="password"
            placeholder="输入密码"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        <label className="remember-pwd">
          <input type="checkbox" checked={rememberPwd} onChange={(e) => setRememberPwd(e.target.checked)} />
          <span>记住密码</span>
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn-primary" type="submit" disabled={loading || !password.trim()}>
          {loading && <span className="spinner" />}
          {loading ? '登录中...' : '登录'}
        </button>
      </form>
    </div>
  );
}
