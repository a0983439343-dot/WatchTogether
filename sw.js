const CACHE_NAME = "wt-shell-20260925-v55";
const LEGACY_ASSET_MAP = {
  "styles.css": "./src/css/styles.css",
  "enhancements.css": "./src/css/enhancements.css",
  "app.js": "./src/js/app.js",
  "enhancements.js": "./src/js/enhancements.js",
  "i18n.js": "./src/js/i18n.js",
  "firebase-config.js": "./config/firebase-config.js",
  "qrcode-generator.js": "./src/vendor/qrcode-generator.js",
  "admin.css": "./admin/admin.css",
  "admin.js": "./admin/admin.js"
};

function getLegacyAssetRequest(request) {
  const scopeUrl = new URL(self.registration.scope);
  const url = new URL(request.url);
  if (url.origin !== scopeUrl.origin) {
    return null;
  }

  const scopePath = scopeUrl.pathname.endsWith("/") ? scopeUrl.pathname : scopeUrl.pathname + "/";
  if (!url.pathname.startsWith(scopePath)) {
    return null;
  }

  const relativePath = url.pathname.slice(scopePath.length).replace(/^\/+/, "");

  if (relativePath === "admin.html" && request.mode === "navigate") {
    return new Response(null, {
      status: 302,
      headers: {
        Location: new URL("./admin/admin.html", scopeUrl).toString(),
        "Cache-Control": "no-store"
      }
    });
  }

  const target = LEGACY_ASSET_MAP[relativePath];
  if (!target) {
    return null;
  }

  return new Request(new URL(target, scopeUrl).toString(), {
    method: request.method,
    headers: request.headers,
    mode: request.mode,
    credentials: request.credentials,
    cache: "no-store",
    redirect: request.redirect,
    referrer: request.referrer,
    referrerPolicy: request.referrerPolicy
  });
}

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

  const legacyResponse = getLegacyAssetRequest(request);
  if (legacyResponse) {
    event.respondWith(
      Promise.resolve(legacyResponse).then(mapped => {
        if (mapped instanceof Response) {
          return mapped;
        }
        return fetch(mapped).then(response => response);
      })
    );
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