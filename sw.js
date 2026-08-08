// Service Worker — 离线缓存
const CACHE = 'yijing-zs-v7';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => 
      cache.addAll([
        '/',
        '/index.html',
        '/auth.js',
        '/sync.js',
        '/editor.js',
        '/knowledge_zs_v3.js',
        '/yijing_core.js',
        '/video_map.js',
        '/hexagram_lines.js',
        '/fupeirong_data.js',
        '/manifest.json'
      ])
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Network-first for API calls, cache-first for static assets
self.addEventListener('fetch', e => {
  // Bypass cache for API calls (github.com)
  if (e.request.url.includes('github.com')) {
    return; // Let the browser handle it normally
  }
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
