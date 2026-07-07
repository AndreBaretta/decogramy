import { useState } from 'react';
import { api } from '../api';
import { navigate } from '../store';

type Step = { label: string; state: 'pending' | 'active' | 'done' | 'error' };

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
const MAX = 10 * 1024 * 1024;

export function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [caption, setCaption] = useState('');
  const [preview, setPreview] = useState<string | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);

  const pick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setError('');
    if (f && !ALLOWED.includes(f.type)) return setError('Apenas JPEG, PNG ou WebP.');
    if (f && f.size > MAX) return setError('Máximo de 10 MB.');
    setFile(f);
    setPreview(f ? URL.createObjectURL(f) : null);
  };

  const setStep = (i: number, state: Step['state']) =>
    setSteps((s) => s.map((st, idx) => (idx === i ? { ...st, state } : st)));

  const submit = async () => {
    if (!file) return;
    setRunning(true);
    setError('');
    const flow: Step[] = [
      { label: '1. API cria publicação + URL assinada', state: 'active' },
      { label: '2. Navegador envia direto para o armazenamento de objetos', state: 'pending' },
      { label: '3. API finaliza → publicação no ar + eventos de outbox', state: 'pending' },
      { label: '4. Worker gera miniatura (assíncrono via RabbitMQ + Sharp)', state: 'pending' },
    ];
    setSteps(flow);
    try {
      const up = await api.createUpload({ mimeType: file.type, sizeBytes: file.size, caption });
      setStep(0, 'done');
      setStep(1, 'active');

      await api.uploadToStorage(up.uploadUrl, file);
      setStep(1, 'done');
      setStep(2, 'active');

      await api.finalize(up.postId);
      setStep(2, 'done');
      setStep(3, 'active');

      // Poll for the async thumbnail to demonstrate the worker pipeline.
      let ready = false;
      for (let i = 0; i < 40; i++) {
        const p = await api.getPost(up.postId);
        if (p.photo?.thumbnailStatus === 'ready') {
          ready = true;
          break;
        }
        if (p.photo?.thumbnailStatus === 'failed') break;
        await new Promise((r) => setTimeout(r, 500));
      }
      setStep(3, ready ? 'done' : 'error');
      setTimeout(() => navigate('/feed'), 800);
    } catch (err: any) {
      setError(Array.isArray(err.message) ? err.message.join(', ') : err.message);
      setSteps((s) => s.map((st) => (st.state === 'active' ? { ...st, state: 'error' } : st)));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="upload">
      <h2>Enviar uma foto</h2>
      <label className="dropzone">
        {preview ? <img src={preview} alt="pré-visualização" /> : <span className="muted">Escolha uma imagem…</span>}
        <input type="file" accept={ALLOWED.join(',')} onChange={pick} hidden />
      </label>
      <input
        className="cap"
        placeholder="Escreva uma legenda…"
        value={caption}
        onChange={(e) => setCaption(e.target.value)}
        maxLength={2200}
      />
      {error && <div className="error">{error}</div>}
      <button className="primary" onClick={submit} disabled={!file || running}>
        {running ? 'Enviando…' : 'Compartilhar'}
      </button>

      {steps.length > 0 && (
        <ul className="steps">
          {steps.map((s, i) => (
            <li key={i} className={`step ${s.state}`}>
              <span className="dot" /> {s.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
