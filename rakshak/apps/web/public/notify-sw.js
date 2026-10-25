// Service worker for the browser version of the phone app (no RAKSHAK app installed). Android browsers show
// notifications only through a service worker; this one does nothing else: no caching, no push, no network access.
// Tapping a notification brings the RAKSHAK tab forward and tells it which alert was tapped.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const extra = e.notification.data || {};
  e.waitUntil(
    (async () => {
      const tabs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const tab = tabs[0];
      if (tab) {
        await tab.focus();
        tab.postMessage({ type: 'rakshak-notification-tap', extra });
      } else await self.clients.openWindow('/#/m/guardian');
    })(),
  );
});
