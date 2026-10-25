// What the QR codes carry.
//   connect   shown on the laptop: the server address and access code, so a phone joins with one scan
//   guardian  shown on the guardian's phone: a temporary-guardian invite (its own code, never the master code)

export type Pairing =
  | { kind: 'connect'; url: string; token: string }
  | { kind: 'guardian'; url: string; code: string; scope: 'all' | 'critical'; expiresAt: number; child: string };

export function encodePairing(p: Pairing): string {
  const q = new URLSearchParams(p.kind === 'connect' ? { u: p.url, t: p.token } : { u: p.url, c: p.code, s: p.scope, e: String(p.expiresAt), n: p.child });
  return `rakshak:${p.kind}?${q.toString()}`;
}

export function decodePairing(text: string): Pairing | null {
  const m = text.trim().match(/^rakshak:(connect|guardian)\?(.*)$/);
  if (!m) return null;
  const q = new URLSearchParams(m[2]);
  const url = q.get('u') ?? '';
  if (!/^https?:\/\//.test(url)) return null;
  if (m[1] === 'connect') return { kind: 'connect', url, token: q.get('t') ?? '' };
  const code = q.get('c') ?? '';
  if (!code.startsWith('tg-')) return null;
  return { kind: 'guardian', url, code, scope: q.get('s') === 'all' ? 'all' : 'critical', expiresAt: Number(q.get('e')) || 0, child: q.get('n') ?? 'the child' };
}
