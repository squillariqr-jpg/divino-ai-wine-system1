// Rete Squillari — Web Push permission + subscription management.
//
// Nothing in this file ever runs automatically on page load beyond
// registering the service worker (registration alone never prompts the
// browser's permission dialog). Notification.requestPermission() is only
// ever called from requestAndSubscribe(), which the UI wires to an
// explicit button click - never from an onload/init path.
(function (root) {
  'use strict';

  // Placeholder only - no real VAPID key is committed to this repo. Until
  // an operator sets this (via a future build-time injection step), every
  // subscribe attempt reports NOT_CONFIGURED instead of silently failing.
  var VAPID_PUBLIC_KEY = (root.RETE_WEB_PUSH_VAPID_PUBLIC_KEY || '').trim();

  function isSupported() {
    return !!(root.navigator && 'serviceWorker' in root.navigator && 'PushManager' in root && 'Notification' in root);
  }

  function permissionState() {
    if (!isSupported()) return 'UNSUPPORTED';
    return root.Notification.permission; // 'default' | 'granted' | 'denied'
  }

  // Whether this deployment has real VAPID key material wired up at all -
  // independent of browser permission state. Lets the UI show "Notifiche
  // push non ancora attive" instead of an activation button that would
  // just fail after the user clicks it (this gate ships with
  // RETE_NOTIFICATIONS_WEB_PUSH_ENABLED=false and no VAPID keys).
  function isConfigured() {
    return !!VAPID_PUBLIC_KEY;
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    var base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    var rawData = root.atob(base64);
    var outputArray = new Uint8Array(rawData.length);
    for (var i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  async function registerServiceWorker() {
    if (!isSupported()) return null;
    return root.navigator.serviceWorker.register('/rete-squillari/sw.js', { scope: '/rete-squillari/' });
  }

  // Called ONLY from an explicit user click handler (e.g. "Attiva le
  // notifiche operative" button) - never automatically.
  async function requestAndSubscribe(adapter) {
    if (!isSupported()) return { ok: false, reason: 'UNSUPPORTED' };
    if (!VAPID_PUBLIC_KEY) return { ok: false, reason: 'NOT_CONFIGURED' };

    var permission = await root.Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: 'PERMISSION_' + permission.toUpperCase() };

    var registration = await registerServiceWorker();
    if (!registration) return { ok: false, reason: 'SW_REGISTRATION_FAILED' };
    await root.navigator.serviceWorker.ready;

    var subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    var json = subscription.toJSON();
    var result = await adapter.subscribePush({
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      authSecret: json.keys.auth,
      userAgent: root.navigator.userAgent,
    });
    return { ok: true, subscriptionId: result.subscription_id };
  }

  async function unsubscribe(adapter, subscriptionId) {
    if (isSupported()) {
      var registration = await root.navigator.serviceWorker.getRegistration('/rete-squillari/');
      var existing = registration && (await registration.pushManager.getSubscription());
      if (existing) await existing.unsubscribe();
    }
    if (subscriptionId) await adapter.unsubscribePush(subscriptionId);
  }

  root.RETE_PUSH_NOTIFICATIONS = {
    isSupported: isSupported,
    isConfigured: isConfigured,
    permissionState: permissionState,
    registerServiceWorker: registerServiceWorker,
    requestAndSubscribe: requestAndSubscribe,
    unsubscribe: unsubscribe,
  };
})(typeof window === 'undefined' ? globalThis : window);
