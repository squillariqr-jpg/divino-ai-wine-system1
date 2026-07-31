// Rete Squillari service worker - Web Push receiver + PWA offline shell.
// Contains no secrets, no API keys, no credentials of any kind: it only
// ever reads the already-decrypted push payload the browser hands it
// (title/body/deepLink/notificationId - never a phone number, PIN, token
// or price) and opens/focuses a normal authenticated app URL on click.
const CACHE_NAME = 'rete-squillari-shell-v1';
const APP_SHELL = ['/rete-squillari/', '/rete-squillari/index.html'];

self.addEventListener('install', function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) { return cache.addAll(APP_SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; }).map(function (k) { return caches.delete(k); }));
    })
  );
  self.clients.claim();
});

self.addEventListener('push', function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }

  var title = data.title || 'Rete Squillari';
  var body = data.body || '';
  var deepLink = data.deepLink || '/rete-squillari';
  var notificationId = data.notificationId || '';

  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/rete-squillari/assets/logo-squillari.png',
      badge: '/rete-squillari/assets/logo-squillari.png',
      data: { deepLink: deepLink, notificationId: notificationId },
      tag: notificationId || undefined,
    })
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var deepLink = (event.notification.data && event.notification.data.deepLink) || '/rete-squillari';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if ('focus' in client) {
          client.navigate(deepLink);
          return client.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(deepLink);
    })
  );
});
