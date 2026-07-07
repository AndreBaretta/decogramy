import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, getToken, setToken } from './api';

interface AuthState {
  userId: string | null;
  username: string | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (b: { email: string; username: string; password: string; displayName: string }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthState>(null as any);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getToken()) {
      setLoading(false);
      return;
    }
    api
      .me()
      .then((u) => {
        setUserId(u.id);
        setUsername(u.username);
      })
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  const afterAuth = (res: { accessToken: string; user: { id: string; username: string } }) => {
    setToken(res.accessToken);
    setUserId(res.user.id);
    setUsername(res.user.username);
  };

  const value: AuthState = {
    userId,
    username,
    loading,
    login: async (email, password) => afterAuth(await api.login({ email, password })),
    register: async (b) => afterAuth(await api.register(b)),
    logout: () => {
      setToken(null);
      setUserId(null);
      setUsername(null);
      location.hash = '#/';
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Minimal hash router: returns the current hash path and updates on change. */
export function useHashRoute() {
  const [route, setRoute] = useState(() => location.hash.slice(1) || '/feed');
  useEffect(() => {
    const onChange = () => setRoute(location.hash.slice(1) || '/feed');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

export function navigate(path: string) {
  location.hash = '#' + path;
}
