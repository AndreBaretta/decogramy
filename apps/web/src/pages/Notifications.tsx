import { useEffect, useState } from 'react';
import { api, getToken, Notification } from '../api';
import { navigate } from '../store';

interface LiveItem {
  id: string;
  type: string;
  actorUsername?: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  live?: boolean;
}

function text(type: string, actor?: string) {
  if (type === 'post.liked') return `${actor ?? 'Alguém'} curtiu sua publicação`;
  if (type === 'user.followed') return `${actor ?? 'Alguém'} começou a seguir você`;
  return `${actor ?? 'Alguém'}: ${type}`;
}

export function NotificationsPage() {
  const [items, setItems] = useState<LiveItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api
      .notifications()
      .then((page) => {
        if (cancelled) return;
        setItems(
          page.items.map((n: Notification) => ({
            id: n.id,
            type: n.type,
            actorUsername: n.actor?.username,
            entityType: n.entityType,
            entityId: n.entityId,
            createdAt: n.createdAt,
          })),
        );
        setCursor(page.nextCursor);
      })
      .finally(() => !cancelled && setLoading(false));
    api.markAllRead().catch(() => {});

    // Live updates over SSE while this page is open.
    const token = getToken();
    let es: EventSource | null = null;
    if (token) {
      es = new EventSource(`${api.apiUrl}/notifications/stream?token=${token}`);
      es.addEventListener('notification', (ev: MessageEvent) => {
        const n = JSON.parse(ev.data);
        setItems((prev) => [
          {
            id: n.notificationId,
            type: n.type,
            actorUsername: n.actorUsername,
            entityType: n.entityType,
            entityId: n.entityId,
            createdAt: n.createdAt,
            live: true,
          },
          ...prev.filter((x) => x.id !== n.notificationId),
        ]);
      });
    }
    return () => {
      cancelled = true;
      es?.close();
    };
  }, []);

  const loadMore = async () => {
    if (!cursor) return;
    const page = await api.notifications(cursor);
    setItems((prev) => [
      ...prev,
      ...page.items.map((n) => ({
        id: n.id,
        type: n.type,
        actorUsername: n.actor?.username,
        entityType: n.entityType,
        entityId: n.entityId,
        createdAt: n.createdAt,
      })),
    ]);
    setCursor(page.nextCursor);
  };

  return (
    <div className="notifs">
      <h2>Notificações</h2>
      <p className="muted small">Ao vivo via Server-Sent Events (distribuição Redis Pub/Sub a partir do worker).</p>
      {loading && <div className="muted center">Carregando…</div>}
      {!loading && items.length === 0 && <div className="empty">Ainda não há notificações.</div>}
      <ul className="notif-list">
        {items.map((n) => (
          <li
            key={n.id}
            className={`notif ${n.live ? 'live' : ''}`}
            onClick={() => n.actorUsername && navigate(`/u/${n.actorUsername}`)}
          >
            <span className="notif-dot" />
            <span>{text(n.type, n.actorUsername)}</span>
            <span className="muted small when">{new Date(n.createdAt).toLocaleString()}</span>
          </li>
        ))}
      </ul>
      {cursor && (
        <button className="ghost more" onClick={loadMore}>
          Carregar mais
        </button>
      )}
    </div>
  );
}
