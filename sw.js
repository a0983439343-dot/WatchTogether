const CACHE_NAME = "wt-shell-20260925-v57";
const ASSETS = [
  "./",
  "./src/css/styles.css",
  "./src/js/app.js",
  "./src/css/enhancements.css",
  "./src/js/enhancements.js",
  "./src/js/i18n.js",
  "./config/firebase-config.js",
  "./manifest.webmanifest",
  "./icon.svg",
  "./src/vendor/qrcode-generator.js",
  "./admin/admin.html",
  "./admin/admin.css",
  "./admin/admin.js"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.all(
        ASSETS.map(asset =>
          cache.add(asset).catch(error => {
            console.warn("[sw] precache failed:", asset, error);
          })
        )
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  const request = event.request;

  if (request.method !== "GET") {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(new Request(request,{cache:"no-store"})).then(response => {
        const headers = new Headers(response.headers);
        headers.set("Cross-Origin-Opener-Policy","same-origin-allow-popups");
        return new Response(response.body,{
          status:response.status,
          statusText:response.statusText,
          headers:headers
        });
      }).catch(() => caches.match(request,{ignoreSearch:true}).then(cached => cached || fetch(request)))
    );
    return;
  }

  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(new Request(request, {cache: "no-store"}))
        .catch(() => caches.match(request,{ignoreSearch:true}).then(cached => cached || Response.error()))
    );
  }
});