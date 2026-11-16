/* Service worker do Reformar.
 * - Guarda a "casca" do app (HTML/JS/CSS/ícones) para abrir sem internet.
 * - NUNCA guarda respostas da API (/api/*): dados sempre vêm do servidor ou da fila local do app.
 */
const CACHE = 'reformar-shell-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icon.svg', '/theme-init.js'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  // Navegação: rede primeiro; sem rede, abre o app guardado.
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/index.html')));
    return;
  }
  // Arquivos estáticos com hash: cache primeiro, depois rede (e guarda).
  if (url.pathname.startsWith('/assets/') || SHELL.includes(url.pathname)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
