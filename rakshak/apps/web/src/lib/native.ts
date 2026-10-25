// Phone-only extras for the Android app (Capacitor). Every function is a safe no-op in a desktop browser.

import { KeepAwake } from '@capacitor-community/keep-awake';
import { App } from '@capacitor/app';
import { Capacitor, registerPlugin, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { LocalNotifications } from '@capacitor/local-notifications';

export const isNative = Capacitor.isNativePlatform();

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
  if (!isNative) return;
  void (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => {});
}

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
  if (url.startsWith('tel:')) return false;
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
  if (!isNative) return Promise.resolve(false);
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
  if (!isNative) return () => {};
  const h = LocalNotifications.addListener('localNotificationActionPerformed', (e) => fn((e.notification.extra ?? {}) as Record<string, string>));
  return () => void h.then((x) => x.remove());
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
