import { useState } from 'react';
import { api, Post } from '../api';
import { useAuth, navigate } from '../store';

const thumbnailStatusLabel: Record<string, string> = {
  pending: 'pendente',
  processing: 'processando',
  ready: 'pronta',
  failed: 'falhou',
};

export function PostCard({ post, onDeleted }: { post: Post; onDeleted?: (id: string) => void }) {
  const { username } = useAuth();
  const [liked, setLiked] = useState(!!post.likedByViewer);
  const [likes, setLikes] = useState(post.likesCount);
  const [busy, setBusy] = useState(false);

  const toggleLike = async () => {
    if (busy) return;
    setBusy(true);
    // optimistic
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    try {
      const res = next ? await api.like(post.id) : await api.unlike(post.id);
      setLikes(res.likesCount);
      setLiked(res.liked);
    } catch {
      setLiked(!next);
      setLikes((n) => n + (next ? -1 : 1));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!confirm('Excluir esta publicação?')) return;
    await api.deletePost(post.id);
    onDeleted?.(post.id);
  };

  const img = post.photo?.originalUrl;
  const mine = post.user?.username === username;

  return (
    <article className="card">
      <div className="card-head">
        <div
          className="avatar"
          onClick={() => post.user && navigate(`/u/${post.user.username}`)}
          title={post.user?.username}
        >
          {post.user?.displayName?.[0]?.toUpperCase() ?? '?'}
        </div>
        <div className="card-user">
          <span className="uname" onClick={() => post.user && navigate(`/u/${post.user.username}`)}>
            {post.user?.username}
          </span>
          <span className="muted small">{new Date(post.createdAt).toLocaleString()}</span>
        </div>
        {mine && (
          <button className="del" onClick={del} title="Excluir">
            ×
          </button>
        )}
      </div>

      {img ? (
        <img className="card-img" src={img} alt={post.caption} loading="lazy" />
      ) : (
        <div className="card-img placeholder">sem imagem</div>
      )}

      <div className="card-body">
        <div className="actions">
          <button className={`like ${liked ? 'on' : ''}`} onClick={toggleLike} disabled={busy}>
            {liked ? '♥' : '♡'} {likes}
          </button>
          {post.photo && post.photo.thumbnailStatus !== 'ready' && (
            <span className="muted small">miniatura: {thumbnailStatusLabel[post.photo.thumbnailStatus]}</span>
          )}
        </div>
        {post.caption && (
          <p className="caption">
            <b>{post.user?.username}</b> {post.caption}
          </p>
        )}
      </div>
    </article>
  );
}
