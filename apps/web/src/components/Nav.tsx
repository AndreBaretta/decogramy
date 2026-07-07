import { useEffect, useRef, useState } from 'react';
import { api, getToken } from '../api';
import { useAuth, useHashRoute, navigate } from '../store';

/**
 * Opens the SSE stream and bumps a live counter whenever the worker fans out a
 * notification for this user (like/follow). Falls back gracefully — if the
 * stream drops, the badge is reconciled from the API on the next poll.
 */
function useLiveNotificationBadge() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api.unreadCount().then((r) => !cancelled && setUnread(r.count)).catch(() => {});

    const token = getToken();
    if (!token) return;
    const es = new EventSource(`${api.apiUrl}/notifications/stream?token=${token}`);
    es.addEventListener('notification', () => setUnread((n) => n + 1));
    es.onerror = () => {
      /* browser auto-reconnects; nothing to do */
    };
    return () => {
      cancelled = true;
      es.close();
    };
  }, []);

  return { unread, clear: () => setUnread(0) };
}

export function Nav() {
  const { username, logout } = useAuth();
  const route = useHashRoute();
  const { unread, clear } = useLiveNotificationBadge();
  const prevUnread = useRef(unread);

  // Flash the tab title on a new live notification (nice for the demo).
  useEffect(() => {
    if (unread > prevUnread.current) {
      document.title = `(${unread}) Decogramy`;
    }
    prevUnread.current = unread;
  }, [unread]);

  const link = (path: string, label: string, extra?: React.ReactNode) => (
    <button
      className={`navlink ${route === path || (path !== '/feed' && route.startsWith(path)) ? 'active' : ''}`}
      onClick={() => {
        if (path === '/notifications') {
          clear();
          document.title = 'Decogramy';
        }
        navigate(path);
      }}
    >
      {label}
      {extra}
    </button>
  );

  return (
    <header className="nav">
      <div className="nav-inner">
        <div className="brand" onClick={() => navigate('/feed')}>
          Decogramy
        </div>
        <nav className="navlinks">
          {link('/feed', 'Início')}
          {link('/explore', 'Explorar')}
          {link('/upload', 'Enviar')}
          {link(
            '/notifications',
            'Alertas',
            unread > 0 ? <span className="badge">{unread}</span> : null,
          )}
          {username && link(`/u/${username}`, 'Perfil')}
        </nav>
        <button className="logout" onClick={logout}>
          Sair
        </button>
      </div>
    </header>
  );
}
