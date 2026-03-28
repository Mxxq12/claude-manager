import { useState, useRef, useCallback } from 'react';

interface Props {
  initialUrl?: string;
}

export function BrowserPreview({ initialUrl = 'http://localhost:3000' }: Props) {
  const [url, setUrl] = useState(initialUrl);
  const [inputUrl, setInputUrl] = useState(initialUrl);
  const webviewRef = useRef<HTMLWebViewElement>(null);

  const navigate = useCallback(() => {
    let target = inputUrl.trim();
    if (!target) return;
    if (!/^https?:\/\//i.test(target)) target = 'http://' + target;
    setUrl(target);
    setInputUrl(target);
  }, [inputUrl]);

  const handleRefresh = () => {
    const wv = webviewRef.current as any;
    if (wv?.reload) wv.reload();
  };

  const handleBack = () => {
    const wv = webviewRef.current as any;
    if (wv?.goBack) wv.goBack();
  };

  const handleForward = () => {
    const wv = webviewRef.current as any;
    if (wv?.goForward) wv.goForward();
  };

  return (
    <div className="browser-preview">
      <div className="browser-toolbar">
        <button className="browser-nav-btn" onClick={handleBack} title="后退">←</button>
        <button className="browser-nav-btn" onClick={handleForward} title="前进">→</button>
        <button className="browser-nav-btn" onClick={handleRefresh} title="刷新">↻</button>
        <input
          className="browser-url-input"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') navigate(); }}
          placeholder="输入 URL..."
        />
        <button className="browser-go-btn" onClick={navigate}>前往</button>
      </div>
      <webview
        ref={webviewRef as any}
        src={url}
        className="browser-webview"
        /* @ts-ignore */
        allowpopups="true"
      />
    </div>
  );
}
