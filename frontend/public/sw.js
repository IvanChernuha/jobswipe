// JobSwipe service worker: lets browsers install the website as an app.
// It deliberately caches nothing but a small offline page, so every visit
// loads the latest site (a deploy shows up at once) and data is never stale.
// Tests: frontend/src/lib/__tests__/pwa.test.ts
const CACHE = 'jobswipe-offline-v1'
const OFFLINE = '/offline.html'

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.add(OFFLINE)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  // Only page loads on this site; the API, files, downloads and sign-in
  // pages on other sites go straight to the network as if we weren't here.
  if (request.method !== 'GET' || request.mode !== 'navigate') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/downloads/')) return
  event.respondWith(fetch(request).catch(() => caches.match(OFFLINE)))
})
