// Phone-only extras for the Android app (Capacitor). In a browser (the phone app opened from a join link, without the
// RAKSHAK app) they fall back to web APIs where those exist: notifications through a service worker, the screen wake
// lock, the dialer through tel: links. Everything else is a safe no-op.

import { KeepAwake } from '@capacitor-community/keep-awake';
import { App } from '@capacitor/app';
import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';

export const isNative = Capacitor.isNativePlatform();
/** A phone or tablet browser (tel: links open the dialer there, unlike on a laptop). */
const mobileBrowser = !isNative && typeof navigator !== 'undefined' && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);

/** Vibration that matches the alert level: a tap for a nudge, a warning for L2, a long siren-like pattern for L3. */
export function buzz(level: 1 | 2 | 3) {
  if (!isNative) {
    navigator.vibrate?.(level === 3 ? [400, 150, 400, 150, 700] : level === 2 ? [180, 90, 180] : 60);
    return;
  }
  if (level === 1) void Haptics.impact({ style: ImpactStyle.Light }).catch(() => {});
  else if (level === 2) void Haptics.notification({ type: NotificationType.Warning }).catch(() => {});
  else [0, 550, 1100].forEach((t, i) => setTimeout(() => void Haptics.vibrate({ duration: i === 2 ? 700 : 400 }).catch(() => {}), t));
}

/** Keeps a waiting phone (e.g. the guardian's) from locking mid-demo, which would also drop the sync connection. */
export function keepAwake(on: boolean) {
  if (!isNative) return webWakeLock(on);
  void (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => {});
}

// Browsers release the wake lock whenever the tab is hidden, so it is taken again when the tab comes back.
let wakeWanted = false;
let wakeLock: { release(): Promise<void> } | null = null;
function webWakeLock(on: boolean) {
  const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
  if (!wl) return;
  wakeWanted = on;
  if (!on) {
    void wakeLock?.release().catch(() => {});
    wakeLock = null;
    return;
  }
  const take = () => void wl.request('screen').then((l) => (wakeLock = l), () => {});
  take();
  if (!wakeListening) {
    wakeListening = true;
    document.addEventListener('visibilitychange', () => wakeWanted && document.visibilityState === 'visible' && take());
  }
}
let wakeListening = false;

/**
 * Opens a phone number or website outside the app. On Android, Capacitor hands non-app URLs to the system, so `tel:`
 * opens the dialer with the number filled in (nothing is dialled until the person presses call). Returns false where
 * it cannot work (a `tel:` link on a laptop).
 */
export function openExternal(url: string): boolean {
  if (isNative) {
    window.location.href = url;
    return true;
  }
  if (url.startsWith('tel:')) {
    if (!mobileBrowser) return false;
    window.location.href = url;
    return true;
  }
  window.open(url, '_blank', 'noopener');
  return true;
}

// Links that open a new tab on a laptop (helplines, reporting portals) leave the app on a phone, through the same path
// as openExternal, instead of replacing the app's own page.
if (isNative && typeof document !== 'undefined') {
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a || !/^(https?:|tel:|mailto:)/i.test(a.href) || a.href.startsWith(location.origin)) return;
      e.preventDefault();
      openExternal(a.href);
    },
    true,
  );
}

// ---------- Android notifications ----------
// Real system notifications (shade, lock screen, heads-up banner). They are raised by the app itself when an alert
// arrives over the live connection; there is no push service, so the app must be open or recently backgrounded.

const CHANNEL = 'rakshak-alerts';
let channelReady: Promise<boolean> | null = null;

/** Creates the high-importance channel and asks for permission (Android 13+). Call from a tap, e.g. role setup. */
export function enableNotifications(): Promise<boolean> {
  if (!isNative) return webNotifications();
  channelReady ??= (async () => {
    try {
      await LocalNotifications.createChannel({ id: CHANNEL, name: 'Safety alerts', description: 'RAKSHAK alerts about the child you look after', importance: 5, visibility: 1, vibration: true, lights: true, lightColor: '#FF3B30' });
      const p = await LocalNotifications.checkPermissions();
      const ok = p.display === 'granted' || (await LocalNotifications.requestPermissions()).display === 'granted';
      return ok;
    } catch {
      return false;
    }
  })();
  return channelReady;
}

const intId = (key: string) => {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) % 2_000_000_000;
};

/** Shows one notification. `key` de-duplicates: the same alert never notifies twice. */
export async function notify(key: string, title: string, body: string, extra: Record<string, string> = {}) {
  if (!isNative) return webNotify(key, title, body, extra);
  if (!(await enableNotifications())) return;
  try {
    await LocalNotifications.schedule({
      // Shown now, not scheduled: without isExactNotification:false the plugin sends the user to the exact-alarm settings page.
      notifications: [{ id: intId(key), title, body, channelId: CHANNEL, smallIcon: 'ic_stat_rakshak', iconColor: '#0A84FF', extra, autoCancel: true, isExactNotification: false }],
    });
  } catch {
    /* notifications unavailable */
  }
}

/** Runs when a notification is tapped (with its `extra`). */
export function onNotificationTap(fn: (extra: Record<string, string>) => void): () => void {
  if (!isNative) {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return () => {};
    const h = (e: MessageEvent) => e.data?.type === 'rakshak-notification-tap' && fn(e.data.extra ?? {});
    navigator.serviceWorker.addEventListener('message', h);
    return () => navigator.serviceWorker.removeEventListener('message', h);
  }
  const h = LocalNotifications.addListener('localNotificationActionPerformed', (e) => fn((e.notification.extra ?? {}) as Record<string, string>));
  return () => void h.then((x) => x.remove());
}

// Browser version: notifications go through public/notify-sw.js (Android browsers have no plain `new Notification`).
// Needs a secure page (https, as through the internet tunnel, or localhost). The permission prompt is asked first so
// it still counts as part of the tap that called enableNotifications().
let webReady: Promise<ServiceWorkerRegistration | null> | null = null;

function webNotifications(): Promise<boolean> {
  if (typeof window === 'undefined' || !('Notification' in window) || !('serviceWorker' in navigator) || !window.isSecureContext) return Promise.resolve(false);
  const asked = Notification.permission === 'default' ? Notification.requestPermission() : Promise.resolve(Notification.permission);
  webReady ??= navigator.serviceWorker
    .register('/notify-sw.js')
    .then(() => navigator.serviceWorker.ready)
    .catch(() => null);
  return Promise.all([asked, webReady]).then(([perm, reg]) => perm === 'granted' && !!reg);
}

async function webNotify(key: string, title: string, body: string, extra: Record<string, string>) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  // Not asked yet (e.g. "Send a test notification"): ask now, while this still runs inside the tap.
  if (!(Notification.permission === 'granted' || (Notification.permission === 'default' && (await webNotifications())))) return;
  const reg = await (webReady ?? (webNotifications(), webReady));
  try {
    await reg?.showNotification(title, { body, tag: key, data: extra, requireInteraction: extra.alertId !== undefined } as NotificationOptions);
  } catch {
    /* notifications unavailable */
  }
}

// ---------- system bars and the back button ----------

// Our own small native plugin (android/.../ScreenColorPlugin.java): the colour behind the system bars.
const ScreenColor = registerPlugin<{ set(o: { color: string }): Promise<void> }>('ScreenColor');

/** Dark icons for light screens (the child's chat), light icons for dark screens, on a matching background. */
export function setBarStyle(screen: 'light' | 'dark', color = screen === 'light' ? '#FFFFFF' : '#0B0B10') {
  if (!isNative) return;
  void SystemBars.setStyle({ style: screen === 'light' ? SystemBarsStyle.Light : SystemBarsStyle.Dark }).catch(() => {});
  void ScreenColor.set({ color }).catch(() => {});
}

/** Android's back gesture/button. The handler returns true when it handled it; otherwise the app goes to the background. */
export function onBack(fn: () => boolean): () => void {
  if (!isNative) return () => {};
  const h = App.addListener('backButton', () => {
    if (!fn()) void App.minimizeApp();
  });
  return () => void h.then((x) => x.remove());
}

// Our own plugin (android/.../GuardianService.java): keeps a guardian's phone connected in the background.
const GuardianService = registerPlugin<{ start(o: { child: string }): Promise<void>; stop(): Promise<void> }>('GuardianService');

/** While on, Android shows "RAKSHAK Guardian is on" and does not freeze the app, so alerts keep arriving. */
export function guardianService(on: boolean, child = 'your child') {
  if (!isNative) return;
  void (on ? GuardianService.start({ child }) : GuardianService.stop()).catch(() => {});
}
