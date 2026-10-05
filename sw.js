/* Santos Desentope — service worker */
importScripts('config.js');
var CACHE = 'santos-v1';
var SHELL = ['./', 'index.html', 'styles.css?v=1', 'app.js?v=1', 'config.js?v=1', 'manifest.json',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-180.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
// rede primeiro (para receber atualizações), cache se estiver sem internet
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(function (r) {
    var cp = r.clone(); caches.open(CACHE).then(function (c) { c.put(e.request, cp); });
    return r;
  }).catch(function () { return caches.match(e.request, { ignoreSearch: false }).then(function (m) { return m || caches.match('index.html'); }); }));
});

self.addEventListener('push', function (e) {
  e.waitUntil(self.registration.pushManager.getSubscription().then(function (sub) {
    if (!sub) return [];
    return fetch(self.API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'pull', endpoint: sub.endpoint }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { return (d && d.notifs) || []; })
      .catch(function () { return []; });
  }).then(function (list) {
    if (!list.length) list = [{ titulo: 'Santos Desentope', corpo: 'Tens novidades na agenda', jobId: '' }];
    return Promise.all(list.map(function (n, i) {
      return self.registration.showNotification(n.titulo, {
        body: n.corpo, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
        tag: (n.jobId || 'geral') + '-' + Date.now() + '-' + i, data: { jobId: n.jobId }, vibrate: [200, 100, 200]
      });
    }));
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = './' + (e.notification.data && e.notification.data.jobId ? '#job=' + e.notification.data.jobId : '');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) { if ('focus' in cs[i]) { cs[i].navigate(url); return cs[i].focus(); } }
    return self.clients.openWindow(url);
  }));
});
