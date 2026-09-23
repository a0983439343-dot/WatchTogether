const CACHE_NAME = "wt-shell-20260923-v1";
const ASSETS = [
  "./",
  "./enhancements.css",
  "./enhancements.js",
  "./firebase-config.js",
  "./manifest.webmanifest",
  "./icon.svg"
];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(ASSETS).catch(() => {}))
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
      (async () => {
        try {
          const response = await fetch(new Request(request,{cache:"no-store"}));
          const headers = new Headers(response.headers);
          headers.set("Cross-Origin-Opener-Policy","same-origin-allow-popups");
          let body = response.body;

          if (response.ok) {
            try {
              const source = await response.text();
              const version = "20260923-formal-v1";
              const withHead = source.replace(
                "</head>",
                '<meta name="theme-color" content="#0b1020">' +
                '<link rel="manifest" href="./manifest.webmanifest?v=' + version + '">' +
                '<link rel="stylesheet" href="./enhancements.css?v=' + version + '">' +
                "</head>"
              );
              body = withHead.replace(
                "</body>",
                '<script src="./enhancements.js?v=' + version + '"></script></body>'
              );
              headers.delete("content-length");
              headers.delete("content-encoding");
              headers.set("content-type","text/html; charset=utf-8");
            } catch (_) {}
          }

          return new Response(body,{
            status:response.status,
            statusText:response.statusText,
            headers:headers
          });
        } catch (_) {
          const cached = await caches.match(request);
          if (cached) {
            const source = await cached.text();
            const headers = new Headers(cached.headers);
            headers.set("Cross-Origin-Opener-Policy","same-origin-allow-popups");
            const version = "20260923-formal-v1";
            const body = source
              .replace("</head>",'<meta name="theme-color" content="#0b1020"><link rel="manifest" href="./manifest.webmanifest?v='+version+'"><link rel="stylesheet" href="./enhancements.css?v='+version+'"></head>')
              .replace("</body>",'<script src="./enhancements.js?v='+version+'"></script></body>');
            headers.delete("content-length");
            return new Response(body,{status:200,headers:headers});
          }
          return fetch(request);
        }
      })()
    );
    return;
  }

  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request).then(cached => cached || Response.error()))
    );
  }
});