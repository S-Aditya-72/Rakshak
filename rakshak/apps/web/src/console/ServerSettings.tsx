import { useState } from 'react';
import { api, ApiError, getServer, setServer } from '../lib/api';
import { isNative } from '../lib/native';
import { bootstrap } from '../store';

type Result = { ok: boolean; text: string } | null;

/** Where the inference service lives: this laptop (default) or the server laptop over Wi-Fi / a tunnel.
 *  onConnected: the laptop reloads its case (bootstrap); phones only refresh status, they mirror the laptop. */
export function ServerSettings({ onConnected = bootstrap }: { onConnected?: () => unknown }) {
  const [url, setUrl] = useState(getServer().url);
  const [token, setToken] = useState(getServer().token);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  const test = async (next: { url: string; token: string }) => {
    const saved = setServer(next);
    setUrl(saved.url);
    setToken(saved.token);
    setBusy(true);
    setResult(null);
    try {
      const h = await api.health();
      const models = [h.roberta.ready ? 'RoBERTa ready' : 'RoBERTa loading', h.qwen.reachable && h.qwen.modelPresent ? 'Qwen ready' : 'Qwen unavailable (rules fallback)'];
      setResult({ ok: true, text: `Connected · ${models.join(' · ')}` });
      await onConnected();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : '';
      const where = saved.url || 'this laptop';
      setResult({
        ok: false,
        text:
          code === 'unauthorized'
            ? (e as ApiError).message
            : code === 'timeout'
              ? `${where} did not answer in time.`
              : `Can't reach the server at ${where}. Same Wi-Fi? Server started with npm run server:lan?`,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cg-box">
      <input className="srv-input" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={isNative ? 'Server address, e.g. 192.168.1.20' : 'This laptop (leave empty) or 192.168.x.x'} inputMode="url" autoCapitalize="off" spellCheck={false} />
      <input className="srv-input" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Access code (from npm run server:lan)" autoCapitalize="off" spellCheck={false} />
      <div className="cg-row">
        <span className={`cg-dot ${result ? (result.ok ? 'ok' : 'warn') : ''}`} />
        <span className="cg-status" title={result?.text}>
          {busy ? 'Testing…' : result?.text ?? (getServer().url ? getServer().url : 'Using this laptop')}
        </span>
        {getServer().url && !isNative && (
          <button className="chip-btn" onClick={() => test({ url: '', token: '' })} disabled={busy}>
            This laptop
          </button>
        )}
        <button className="cg-continue" onClick={() => test({ url, token })} disabled={busy}>
          Save & test
        </button>
      </div>
    </div>
  );
}
