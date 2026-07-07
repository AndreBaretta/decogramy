import { useState } from 'react';
import { useAuth } from '../store';

export function AuthPage() {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [form, setForm] = useState({ email: '', password: '', username: '', displayName: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') await login(form.email, form.password);
      else
        await register({
          email: form.email,
          password: form.password,
          username: form.username,
          displayName: form.displayName || form.username,
        });
    } catch (err: any) {
      setError(Array.isArray(err.message) ? err.message.join(', ') : err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-card">
        <h1 className="brand big">Decogramy</h1>
        <p className="muted">Uma pequena rede de fotos — MVP de sistemas distribuídos.</p>
        <form onSubmit={submit}>
          <input placeholder="e-mail" type="email" value={form.email} onChange={set('email')} required />
          {mode === 'register' && (
            <>
              <input
                placeholder="nome de usuário (a-z, 0-9, _)"
                value={form.username}
                onChange={set('username')}
                required
              />
              <input placeholder="nome de exibição" value={form.displayName} onChange={set('displayName')} />
            </>
          )}
          <input
            placeholder="senha (mín. 8)"
            type="password"
            value={form.password}
            onChange={set('password')}
            required
          />
          {error && <div className="error">{error}</div>}
          <button className="primary" disabled={busy}>
            {busy ? '…' : mode === 'login' ? 'Entrar' : 'Criar conta'}
          </button>
        </form>
        <button className="switch" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Não tem uma conta? Cadastre-se' : 'Já tem uma conta? Entrar'}
        </button>
      </div>
    </div>
  );
}
