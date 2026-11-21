const prefix = 'pro-pdf-editor-';
const cacheName = prefix + '2026-11-21-3';
const shell = [
    './', './index.html', './style.css', './app.js', './organizer.js', './document-tools.js',
    './versions.js', './workspace-tools.js', './install.js', './fonts.js', './signature.js', './allura-latin.woff2', './manifest.webmanifest', './favicon.svg', './icon-192.png', './icon-512.png',
    './vendor/pdf.min.js', './vendor/pdf.worker.min.js', './vendor/pdf-lib.min.js'
].map(path => new URL(path, self.registration.scope).href);
const cachedAssets = new Set(shell);

self.addEventListener('install', event => {
    event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(shell.map(url => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(keys => Promise.all(
        keys.filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key))
    )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
    const { request } = event;
    if (request.method !== 'GET') return;
    const url = new URL(request.url);
    if (request.mode === 'navigate' && (url.href === shell[0] || url.href === shell[1])) {
        event.respondWith(caches.open(cacheName).then(cache => cache.match(shell[1])).then(response => response || fetch(request)));
    } else if (cachedAssets.has(url.href)) {
        event.respondWith(caches.open(cacheName).then(cache => cache.match(request.url)).then(response => response || fetch(request)));
    }
});
