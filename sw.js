/* Meu caixa: service worker
   - deixa o app instalável e abrir sem internet (só os arquivos do próprio site)
   - permite notificações no Chrome do celular
   - nunca guarda respostas da /api/ nem de outros domínios (Firebase, Pluggy) */
const VERSAO = 'meu-caixa-v1';
const ARQUIVOS = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSAO).then(c => c.addAll(ARQUIVOS).catch(() => {})).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSAO).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// rede primeiro (sempre a versão mais nova); sem internet, usa o que está guardado
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok && res.type === 'basic') { const cp = res.clone(); caches.open(VERSAO).then(c => c.put(req, cp)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined)))
  );
});

// tocar na notificação abre (ou traz para frente) o app
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(lista => {
      for (const c of lista) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow('./');
    })
  );
});
