import { useEffect, useState } from 'react';
import { api, Post, Profile } from '../api';

export function ProfilePage({ username }: { username: string }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setError('');
    try {
      const [p, grid] = await Promise.all([api.profile(username), api.userPosts(username)]);
      setProfile(p);
      setPosts(grid.items);
      setCursor(grid.nextCursor);
    } catch (e: any) {
      setError(e.message);
    }
  };

  useEffect(() => {
    setProfile(null);
    setPosts([]);
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  const toggleFollow = async () => {
    if (!profile || busy) return;
    setBusy(true);
    try {
      if (profile.isFollowing) await api.unfollow(username);
      else await api.follow(username);
      setProfile((p) =>
        p
          ? {
              ...p,
              isFollowing: !p.isFollowing,
              followersCount: p.followersCount + (p.isFollowing ? -1 : 1),
            }
          : p,
      );
    } finally {
      setBusy(false);
    }
  };

  const loadMore = async () => {
    if (!cursor) return;
    const page = await api.userPosts(username, cursor);
    setPosts((ps) => [...ps, ...page.items]);
    setCursor(page.nextCursor);
  };

  if (error) return <div className="empty">{error}</div>;
  if (!profile) return <div className="muted center">Carregando…</div>;

  return (
    <div className="profile">
      <header className="profile-head">
        <div className="avatar big">{profile.displayName[0]?.toUpperCase()}</div>
        <div className="profile-meta">
          <div className="profile-top">
            <h2>{profile.username}</h2>
            {!profile.isSelf && (
              <button className={profile.isFollowing ? 'ghost' : 'primary'} onClick={toggleFollow} disabled={busy}>
                {profile.isFollowing ? 'Seguindo' : 'Seguir'}
              </button>
            )}
          </div>
          <div className="stats">
            <span>
              <b>{profile.postsCount}</b> publicações
            </span>
            <span>
              <b>{profile.followersCount}</b> seguidores
            </span>
            <span>
              <b>{profile.followingCount}</b> seguindo
            </span>
          </div>
          <div className="displayname">{profile.displayName}</div>
          {profile.bio && <div className="bio">{profile.bio}</div>}
        </div>
      </header>

      {posts.length === 0 ? (
        <div className="empty">Ainda não há publicações.</div>
      ) : (
        <div className="grid">
          {posts.map((p) => {
            const src =
              p.photo && p.photo.thumbnailStatus === 'ready' ? p.photo.thumbnailUrl : p.photo?.originalUrl;
            return (
              <a key={p.id} className="grid-item" href={`#/`} onClick={(e) => e.preventDefault()}>
                {src ? <img src={src} alt={p.caption} loading="lazy" /> : <div className="ph" />}
                <span className="grid-likes">♥ {p.likesCount}</span>
              </a>
            );
          })}
        </div>
      )}
      {cursor && (
        <button className="ghost more" onClick={loadMore}>
          Carregar mais
        </button>
      )}
    </div>
  );
}
