import { describe, expect, it } from 'vitest';
import { decodePairing, encodePairing } from './pairing';

describe('QR pairing links', () => {
  it('connect: an ordinary link the camera opens, and the app scanner reads back', () => {
    const text = encodePairing({ kind: 'connect', url: 'https://quiet-river.trycloudflare.com', token: 'abcd-efgh-jkmn' });
    expect(text).toBe('https://quiet-river.trycloudflare.com/#/join?t=abcd-efgh-jkmn');
    expect(decodePairing(text)).toEqual({ kind: 'connect', url: 'https://quiet-river.trycloudflare.com', token: 'abcd-efgh-jkmn' });
  });

  it('connect over Wi-Fi keeps the port', () => {
    const text = encodePairing({ kind: 'connect', url: 'http://192.168.1.20:8787', token: 't' });
    expect(decodePairing(text)).toEqual({ kind: 'connect', url: 'http://192.168.1.20:8787', token: 't' });
  });

  it('temporary-guardian invite carries its own code, scope and expiry', () => {
    const p = { kind: 'guardian' as const, url: 'https://quiet-river.trycloudflare.com', code: 'tg-123', scope: 'critical' as const, expiresAt: 1790000000000, child: 'Meera' };
    expect(decodePairing(encodePairing(p))).toEqual(p);
  });

  it('still reads codes shown by the earlier app build', () => {
    expect(decodePairing('rakshak:connect?u=http%3A%2F%2F192.168.1.20%3A8787&t=abc')).toEqual({ kind: 'connect', url: 'http://192.168.1.20:8787', token: 'abc' });
  });

  it('rejects anything else', () => {
    expect(decodePairing('https://example.com/')).toBeNull();
    expect(decodePairing('https://x.trycloudflare.com/#/join?c=not-an-invite')).toBeNull();
    expect(decodePairing('hello')).toBeNull();
  });
});
