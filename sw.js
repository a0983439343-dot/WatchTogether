/*
 * WatchTogether GitHub Pages Auth compatibility
 *
 * Firebase Google Popup Auth 需要 opener 保留 popup window 參照。
 * GitHub Pages 無法直接設定 HTTP COOP header，因此由同源
 * Service Worker 對 HTML navigation 回應補上：
 *
 * Cross-Origin-Opener-Policy: same-origin-allow-popups
 */

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    self.clients.claim()
  );
});

self.addEventListener("fetch", (event) => {
  const request =
    event.request;

  if (
    request.method !== "GET" ||
    request.mode !== "navigate"
  ) {
    return;
  }

  event.respondWith(
    (async () => {
      try {
        /*
         * 導覽頁永遠不要吃舊 HTTP cache。
         * 否則 GitHub Pages 更新 index.html 後，
         * 仍可能載入舊版 app.js 版本號。
         */
        const response =
          await fetch(
            new Request(
              request,
              {
                cache:
                  "no-store"
              }
            )
          );

        const headers =
          new Headers(
            response.headers
          );

        headers.set(
          "Cross-Origin-Opener-Policy",
          "same-origin-allow-popups"
        );

        return new Response(
          response.body,
          {
            status:
              response.status,
            statusText:
              response.statusText,
            headers
          }
        );
      } catch (error) {
        console.error(
          "[WatchTogether SW] Navigation fetch failed:",
          error
        );

        return fetch(request);
      }
    })()
  );
});
