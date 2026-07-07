import { useAuth, useHashRoute } from './store';
import { AuthPage } from './pages/Auth';
import { FeedPage } from './pages/Feed';
import { UploadPage } from './pages/Upload';
import { ProfilePage } from './pages/Profile';
import { NotificationsPage } from './pages/Notifications';
import { Nav } from './components/Nav';

export function App() {
  const { userId, loading } = useAuth();
  const route = useHashRoute();

  if (loading) return <div className="center muted">Carregando…</div>;
  if (!userId) return <AuthPage />;

  let page;
  if (route.startsWith('/u/')) page = <ProfilePage username={decodeURIComponent(route.slice(3))} />;
  else if (route === '/upload') page = <UploadPage />;
  else if (route === '/explore') page = <FeedPage mode="explore" />;
  else if (route === '/notifications') page = <NotificationsPage />;
  else page = <FeedPage mode="home" />;

  return (
    <div className="app">
      <Nav />
      <main className="content">{page}</main>
    </div>
  );
}
