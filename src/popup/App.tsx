import { useEffect, useState } from 'react';
import { APP_NAME, APP_VERSION } from '../shared/constants';
import { sendToBackground } from '../shared/messaging';

type ConnStatus = 'pending' | 'connected' | 'disconnected';

export function App() {
  const [status, setStatus] = useState<ConnStatus>('pending');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const start = performance.now();

    sendToBackground({ type: 'PING' })
      .then((res) => {
        if (cancelled) return;
        setStatus('connected');
        setLatencyMs(Math.round(performance.now() - start));
        console.log(`[${APP_NAME}] PONG at ${res.at}`);
      })
      .catch((err) => {
        if (cancelled) return;
        setStatus('disconnected');
        console.error(`[${APP_NAME}] ping failed:`, err);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="popup">
      <header className="popup__header">
        <h1 className="popup__title">{APP_NAME}</h1>
        <span className="popup__version">v{APP_VERSION}</span>
      </header>
      <p className="popup__tagline">Freeze workspaces. Restore your brain.</p>

      <footer className={`popup__status popup__status--${status}`}>
        <span className="popup__status-dot" aria-hidden />
        <span className="popup__status-label">
          {status === 'pending' && 'connecting…'}
          {status === 'connected' && `background OK${latencyMs !== null ? ` · ${latencyMs}ms` : ''}`}
          {status === 'disconnected' && 'background unreachable'}
        </span>
      </footer>
    </main>
  );
}
