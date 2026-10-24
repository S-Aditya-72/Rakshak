import { ExternalLink, LogOut, ShieldAlert } from 'lucide-react';
import { useEffect } from 'react';
import { chatgptConsent, chatgptSignIn, chatgptSignOut, refreshChatGPT, selectChatGPTModel, useDemo } from '../store';

const USAGE_URL = 'https://chatgpt.com/settings/usage';

/** Sign in with ChatGPT controls. Tokens live in the local companion process; this panel only sees status. */
export function ChatGPTPanel() {
  const cg = useDemo((s) => s.data.chatgpt);
  const st = cg.status;

  useEffect(() => {
    void refreshChatGPT();
  }, []);

  if (!st || !st.enabled) {
    return <div className="cg-box cg-off">ChatGPT backend disabled on the server (RAKSHAK_CHATGPT_ENABLED=0).</div>;
  }
  if (!st.reachable) {
    return (
      <div className="cg-box cg-off">
        <b>Unavailable.</b> {st.reason ?? 'The Sign in with ChatGPT companion is not running.'} Start it with <code>npm run companion</code>. The local hybrid backend is unaffected.
      </div>
    );
  }

  const connected = st.status === 'connected';
  return (
    <div className="cg-box">
      <div className="cg-row">
        <span className={`cg-dot ${connected && st.sharing ? 'ok' : connected ? 'warn' : ''}`} />
        <span className="cg-status">
          {st.status === 'connecting'
            ? 'Waiting for browser sign-in…'
            : connected
              ? `Connected${st.identity?.email ? ` · ${st.identity.email}` : st.identity?.name ? ` · ${st.identity.name}` : ''}`
              : st.status === 'reauth_required'
                ? 'Sign-in expired. Reconnect.'
                : 'Not connected'}
        </span>
        {connected ? (
          <button className="chip-btn" onClick={() => chatgptSignOut()} title="Sign out of this ChatGPT account">
            <LogOut size={12} /> Sign out
          </button>
        ) : (
          <button className="cg-continue" onClick={() => chatgptSignIn()} disabled={cg.busy}>
            {cg.busy ? 'Opening browser…' : 'Continue with ChatGPT'}
          </button>
        )}
      </div>

      {connected && !st.sharing && (
        <div className="cg-warn">
          <ShieldAlert size={13} /> ChatGPT plan usage was not granted for this sign-in. Reconnect and allow plan usage, or keep using the local backend.
        </div>
      )}

      {connected && st.sharing && (
        <>
          <div className="cg-row">
            <span className="pop-k">Model</span>
            <select className="cg-select" value={cg.model ?? ''} onChange={(e) => selectChatGPTModel(e.target.value)}>
              {cg.models.length === 0 && <option value="">No models discovered</option>}
              {cg.models.map((m) => (
                <option key={m.slug} value={m.slug}>
                  {m.displayName}
                </option>
              ))}
            </select>
            <a className="chip-btn" href={USAGE_URL} target="_blank" rel="noreferrer">
              Manage usage <ExternalLink size={11} />
            </a>
          </div>
          <label className="cg-consent">
            <input type="checkbox" checked={!!st.consent} onChange={(e) => chatgptConsent(e.target.checked)} />
            <span>
              I am the account owner. When I press “Analyze with ChatGPT”, the open <b>synthetic</b> conversation and related case evidence are sent to OpenAI for processing.
              Nothing is sent automatically, and typing by other people never triggers a request.
            </span>
          </label>
        </>
      )}
      {cg.error && <div className="cg-warn">{cg.error}</div>}
    </div>
  );
}
