const CACHE_NAME = 'yamb-pro-v25'; // Promenjeno na v25 da forsiramo update
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icon.png',
  './css/style.css',
  './js/main.js',
  './js/YambApp.js',
  './js/utils.js',
  './js/constants.js',
  './js/modules/ModalSystem.js',
  './js/modules/SoundManager.js',
  './js/modules/YambAI.js',
  // OBAVEZNO: Lokalni fajlovi
  './js/libs/socket.io.min.js',
  './js/libs/confetti.browser.min.js'
];

// 1. INSTALACIJA
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// 2. AKTIVACIJA (Brisanje starog keša)
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Brisanje starog keša:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  return self.clients.claim();
});

// 3. FETCH
self.addEventListener('fetch', (e) => {
  if (!e.request.url.startsWith('http')) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        return res;
      })
      .catch(() => {
        return caches.match(e.request);
      })
  );
});