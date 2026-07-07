import { useCallback, useEffect, useState } from 'react';
import { api, Post } from '../api';
import { PostCard } from '../components/PostCard';
import { navigate } from '../store';

export function FeedPage({ mode }: { mode: 'home' | 'explore' }) {
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (reset = false) => {
      setLoading(true);
      const fn = mode === 'home' ? api.feed : api.explore;
      const page = await fn(reset ? undefined : cursor ?? undefined);
      setPosts((prev) => (reset ? page.items : [...prev, ...page.items]));
      setCursor(page.nextCursor);
      setDone(!page.nextCursor);
      setLoading(false);
    },
    [mode, cursor],
  );

  useEffect(() => {
    setPosts([]);
    setCursor(null);
    setDone(false);
    load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <div className="feed">
      <div className="feed-head">
        <h2>{mode === 'home' ? 'Início' : 'Explorar'}</h2>
        <button className="ghost" onClick={() => load(true)}>
          ↻ Atualizar
        </button>
      </div>

      {posts.length === 0 && !loading && (
        <div className="empty">
          {mode === 'home' ? (
            <>
              Seu feed inicial está vazio. <a onClick={() => navigate('/explore')}>Explore publicações</a> e siga
              pessoas, ou <a onClick={() => navigate('/upload')}>envie</a> sua primeira foto.
            </>
          ) : (
            <>Ainda não há publicações. Seja a primeira pessoa a <a onClick={() => navigate('/upload')}>enviar</a>.</>
          )}
        </div>
      )}

      {posts.map((p) => (
        <PostCard key={p.id} post={p} onDeleted={(id) => setPosts((ps) => ps.filter((x) => x.id !== id))} />
      ))}

      {loading && <div className="muted center">Carregando…</div>}
      {!done && !loading && posts.length > 0 && (
        <button className="ghost more" onClick={() => load()}>
          Carregar mais
        </button>
      )}
    </div>
  );
}
