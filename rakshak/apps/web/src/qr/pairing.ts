// What the QR codes carry.
//   connect   shown on the laptop: the server address and access code, so a phone joins with one scan
//   guardian  shown on the guardian's phone: a temporary-guardian invite (its own code, never the master code)
//
// Both are ordinary links to the server (https://…/#/join?…), which also serves the web app: a phone without the
// RAKSHAK app scans them with its camera and gets the same app in the browser; the app's own scanner reads them too.

export type Pairing =
  | { kind: 'connect'; url: string; token: string }
  | { kind: 'guardian'; url: string; code: string; scope: 'all' | 'critical'; expiresAt: number; child: string };

export function encodePairing(p: Pairing): string {
  const q = new URLSearchParams(p.kind === 'connect' ? { t: p.token } : { c: p.code, s: p.scope, e: String(p.expiresAt), n: p.child });
  return `${p.url.replace(/\/+$/, '')}/#/join?${q.toString()}`;
}

/** Reads a scanned code: a join link, or the older rakshak:connect?u=… / rakshak:guardian?u=… form. */
export function decodePairing(text: string): Pairing | null {
  const t = text.trim();
  let url: string;
  let q: URLSearchParams;
  const link = t.match(/^(https?:\/\/[^/#?\s]+)\/?#\/join\?(.*)$/i);
  const old = t.match(/^rakshak:(connect|guardian)\?(.*)$/);
  if (link) {
    url = link[1];
    q = new URLSearchParams(link[2]);
  } else if (old) {
    q = new URLSearchParams(old[2]);
    url = q.get('u') ?? '';
    if (!/^https?:\/\//.test(url)) return null;
  } else return null;
  const code = q.get('c');
  if (code === null) return { kind: 'connect', url, token: q.get('t') ?? '' };
  if (!code.startsWith('tg-')) return null;
  return { kind: 'guardian', url, code, scope: q.get('s') === 'all' ? 'all' : 'critical', expiresAt: Number(q.get('e')) || 0, child: q.get('n') ?? 'the child' };
}

/** The join link this page was opened with (#/join?…), as the scanner would have read it. */
export function pairingFromLocation(): Pairing | null {
  return typeof location === 'undefined' ? null : decodePairing(`${location.origin}/${location.hash}`);
}
