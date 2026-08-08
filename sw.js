// Service Worker — 离线缓存
const CACHE = 'yijing-zs-v5';

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(cache => 
      cache.addAll([
        '/',
        '/index.html',
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

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
