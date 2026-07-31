// Rete Squillari — in-app notification center (bell + panel).
//
// Mounted only once a GOVERNED_BACKEND actor exists (see index.html's
// loadSession hook) - never for the DEMO_LOCAL fixture mode, since the
// governed RPCs this module calls require a real authenticated session.
// Every string here is static Italian copy or server-rendered
// title/body/deep_link already produced by rete_notification_render_copy -
// this file never renders a phone number, PIN, token or price, and never
// exposes push subscription internals.
(function (root) {
  'use strict';

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === 'style') node.setAttribute('style', attrs[k]);
      else if (k === 'text') node.textContent = attrs[k];
      else node.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function formatRelative(iso) {
    var diffMs = Date.now() - new Date(iso).getTime();
    var mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'adesso';
    if (mins < 60) return mins + ' min fa';
    var hours = Math.floor(mins / 60);
    if (hours < 24) return hours + ' h fa';
    return Math.floor(hours / 24) + ' g fa';
  }

  function createNotificationCenter(adapter) {
    var badge = el('span', {
      style: 'position:absolute;top:-4px;right:-4px;background:#b64935;color:#fff;border-radius:10px;' +
        'min-width:16px;height:16px;font:700 10px Arial;line-height:16px;text-align:center;padding:0 3px;display:none'
    });
    var bell = el('button', {
      'aria-label': 'Notifiche', title: 'Notifiche',
      style: 'position:relative;background:none;border:0;cursor:pointer;font-size:20px;line-height:1;padding:6px;color:inherit'
    }, [document.createTextNode('🔔'), badge]);

    var panel = el('div', {
      style: 'display:none;position:absolute;right:0;top:38px;width:340px;max-width:90vw;max-height:70vh;overflow:auto;' +
        'background:#fffdf8;border:1px solid #e5ded2;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,.15);z-index:20;padding:10px'
    });

    var wrap = el('div', { style: 'position:relative;display:inline-block' }, [bell, panel]);

    var state = { open: false, items: [], loading: false, error: null };

    function renderPanel() {
      panel.innerHTML = '';
      var header = el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px' });
      header.appendChild(el('strong', { text: 'Notifiche', style: 'font-size:14px' }));
      var markAll = el('button', {
        text: 'Segna tutte come lette',
        style: 'background:none;border:0;color:#567565;font:11px Arial;cursor:pointer;text-decoration:underline'
      });
      markAll.addEventListener('click', async function () {
        try {
          await adapter.markAllNotificationsRead();
          await refresh();
        } catch (e) { /* transient - next open retries */ }
      });
      header.appendChild(markAll);
      panel.appendChild(header);

      if (state.loading) {
        panel.appendChild(el('div', { text: 'Caricamento…', style: 'color:#6d756f;font:12px Arial;padding:20px;text-align:center' }));
        return;
      }
      if (state.error) {
        var errBox = el('div', { style: 'text-align:center;padding:20px' });
        errBox.appendChild(el('div', { text: 'Impossibile caricare le notifiche.', style: 'color:#943a2c;font:12px Arial;margin-bottom:8px' }));
        var retry = el('button', { text: 'Riprova', style: 'background:#eee8dd;border:0;border-radius:8px;padding:6px 10px;font:11px Arial;cursor:pointer' });
        retry.addEventListener('click', refresh);
        errBox.appendChild(retry);
        panel.appendChild(errBox);
        return;
      }
      if (state.items.length === 0) {
        panel.appendChild(el('div', { text: 'Nessuna notifica.', style: 'color:#6d756f;font:12px Arial;padding:20px;text-align:center' }));
        return;
      }

      state.items.forEach(function (item) {
        var isUnread = !item.read_at;
        var row = el('div', {
          style: 'padding:10px 4px;border-bottom:1px solid #eee5d5;cursor:pointer;' + (isUnread ? 'background:#fbf3e4' : '')
        });
        var titleRow = el('div', { style: 'display:flex;justify-content:space-between;gap:8px' });
        titleRow.appendChild(el('strong', { text: item.title, style: 'font:' + (isUnread ? '700' : '400') + ' 13px Arial' }));
        titleRow.appendChild(el('span', { text: formatRelative(item.created_at), style: 'color:#6d756f;font:10px Arial;white-space:nowrap' }));
        row.appendChild(titleRow);
        row.appendChild(el('div', { text: item.body, style: 'font:12px Arial;color:#3a3f3b;margin-top:3px' }));
        row.addEventListener('click', async function () {
          if (isUnread) {
            try { await adapter.markNotificationRead(item.delivery_id); } catch (e) { /* ignore, navigation proceeds regardless */ }
          }
          root.location.href = item.deep_link;
        });
        panel.appendChild(row);
      });

      panel.appendChild(renderPushSettings());
    }

    function renderPushSettings() {
      var box = el('div', { style: 'margin-top:10px;padding-top:10px;border-top:1px solid #eee5d5' });
      var push = root.RETE_PUSH_NOTIFICATIONS;
      if (!push || !push.isSupported()) {
        box.appendChild(el('div', { text: 'Le notifiche push non sono supportate su questo browser.', style: 'color:#6d756f;font:11px Arial' }));
        return box;
      }
      var permission = push.permissionState();
      if (permission === 'granted') {
        box.appendChild(el('div', { text: 'Notifiche push attive su questo dispositivo.', style: 'color:#41654e;font:11px Arial' }));
        return box;
      }
      if (permission === 'denied') {
        box.appendChild(el('div', { text: 'Notifiche push bloccate dal browser per questo sito.', style: 'color:#943a2c;font:11px Arial' }));
        return box;
      }
      if (!push.isConfigured()) {
        box.appendChild(el('div', { text: 'Notifiche push non ancora attive.', style: 'color:#6d756f;font:11px Arial' }));
        return box;
      }
      box.appendChild(el('strong', { text: 'Attiva le notifiche operative', style: 'display:block;font:700 12px Arial;margin-bottom:3px' }));
      box.appendChild(el('div', {
        text: 'Riceverai avvisi per merce da preparare, trasferimenti e arrivi.',
        style: 'color:#6d756f;font:11px Arial;margin-bottom:6px'
      }));
      var enableBtn = el('button', {
        text: 'Attiva', style: 'background:#567565;color:#fff;border:0;border-radius:8px;padding:6px 12px;font:11px Arial;cursor:pointer'
      });
      enableBtn.addEventListener('click', async function () {
        var result = await push.requestAndSubscribe(adapter);
        if (!result.ok) { enableBtn.textContent = 'Non disponibile'; enableBtn.disabled = true; return; }
        renderPanel();
      });
      box.appendChild(enableBtn);
      return box;
    }

    async function refresh() {
      state.loading = true; state.error = null;
      renderPanel();
      try {
        var items = await adapter.listNotifications({ limit: 30 });
        state.items = items || [];
        state.loading = false;
        renderPanel();
      } catch (e) {
        state.loading = false;
        state.error = e;
        renderPanel();
      }
    }

    async function refreshUnreadCount() {
      try {
        var count = await adapter.unreadNotificationCount();
        if (count > 0) {
          badge.textContent = count > 99 ? '99+' : String(count);
          badge.style.display = 'block';
        } else {
          badge.style.display = 'none';
        }
      } catch (e) {
        // Leave last-known badge state - a transient count failure should
        // not visually claim "zero unread".
      }
    }

    bell.addEventListener('click', async function () {
      state.open = !state.open;
      panel.style.display = state.open ? 'block' : 'none';
      if (state.open) {
        await refresh();
        await refreshUnreadCount();
      }
    });

    document.addEventListener('click', function (evt) {
      if (state.open && !wrap.contains(evt.target)) {
        state.open = false;
        panel.style.display = 'none';
      }
    });

    refreshUnreadCount();

    return { element: wrap, refreshUnreadCount: refreshUnreadCount };
  }

  root.RETE_NOTIFICATION_CENTER = {
    mount: function (adapter, mountPoint) {
      var target = mountPoint || document.querySelector('.head') || document.body;
      var center = createNotificationCenter(adapter);
      target.appendChild(center.element);
      return center;
    },
  };
})(typeof window === 'undefined' ? globalThis : window);
