/* Offline support: the app shell and pictures come from the cache, and each visit
   checks for a newer version in the background so updates arrive on the next open. */
const VERSION = "abhyasa-v15";
const SHELL = ["./", "index.html", "platform.js", "manifest.webmanifest", "gita.json", "vendor/anthropic.mjs",
  "icons/icon-192.png", "icons/logo-128.png", "img/krishna-arjuna.jpg", "icons/icon-512.png", "icons/apple-touch-icon.png",
  "img/baby-krsna.jpg", "img/cowherd-lunch.jpg", "img/vrindavan-forest.jpg", "img/damodara.jpg",
  "img/animals.jpg", "img/subordinate.jpg", "img/ordinary-boy.jpg", "img/baka.jpg"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if(e.request.method !== "GET" || url.origin !== location.origin) return;
  // stale-while-revalidate: answer from cache at once, refresh the cache from the network
  e.respondWith(caches.open(VERSION).then(async cache => {
    const cached = await cache.match(e.request, {ignoreSearch: true});
    const fresh = fetch(e.request).then(r => { if(r.ok) cache.put(e.request, r.clone()); return r; }).catch(() => cached);
    return cached || fresh;
  }));
});
