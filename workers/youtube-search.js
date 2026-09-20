/*
 * WatchTogether - YouTube Search Proxy
 *
 * Deploy this file as a Cloudflare Worker.
 * Add a Worker secret:
 *   YOUTUBE_API_KEY=<new YouTube Data API key>
 *
 * Optional Worker variable:
 *   ALLOWED_ORIGIN=https://a0983439343-dot.github.io
 *
 * The browser NEVER receives the YouTube API key.
 */

const DEFAULT_ALLOWED_ORIGIN =
  "https://a0983439343-dot.github.io";

const CACHE_TTL_SECONDS = 30;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_LIMIT = 20;

const ipBuckets =
  new Map();

function corsHeaders(origin, allowedOrigin) {
  const allowed =
    allowedOrigin === "*"
      ? "*"
      : origin === allowedOrigin
        ? origin
        : allowedOrigin;

  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Vary": "Origin"
  };
}

function jsonResponse(
  body,
  status = 200,
  origin = "",
  allowedOrigin = DEFAULT_ALLOWED_ORIGIN
) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        ...corsHeaders(
          origin,
          allowedOrigin
        )
      }
    }
  );
}

function parseIsoDuration(value) {
  const text =
    String(value || "");

  const match =
    text.match(
      /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/
    );

  if (!match) {
    return 0;
  }

  return (
    Number(match[1] || 0) * 3600 +
    Number(match[2] || 0) * 60 +
    Number(match[3] || 0)
  );
}

async function isRateLimited(ip) {
  const now =
    Date.now();

  const record =
    ipBuckets.get(ip);

  if (
    !record ||
    now - record.start >=
      RATE_WINDOW_MS
  ) {
    ipBuckets.set(
      ip,
      {
        start: now,
        count: 1
      }
    );

    return false;
  }

  record.count += 1;

  return (
    record.count >
    RATE_LIMIT
  );
}

export default {
  async fetch(request, env, ctx) {
    const url =
      new URL(request.url);

    const origin =
      request.headers.get(
        "Origin"
      ) || "";

    const allowedOrigin =
      String(
        env.ALLOWED_ORIGIN ||
        DEFAULT_ALLOWED_ORIGIN
      ).trim();

    if (
      request.method ===
      "OPTIONS"
    ) {
      return new Response(
        null,
        {
          status: 204,
          headers:
            corsHeaders(
              origin,
              allowedOrigin
            )
        }
      );
    }

    if (
      request.method !==
      "GET"
    ) {
      return jsonResponse(
        {
          error: {
            message:
              "只允許 GET"
          }
        },
        405,
        origin,
        allowedOrigin
      );
    }

    if (
      allowedOrigin !== "*" &&
      origin !== allowedOrigin
    ) {
      return jsonResponse(
        {
          error: {
            message:
              "不允許的來源"
          }
        },
        403,
        origin,
        allowedOrigin
      );
    }

    const apiKey =
      String(
        env.YOUTUBE_API_KEY ||
        ""
      ).trim();

    if (!apiKey) {
      return jsonResponse(
        {
          error: {
            message:
              "Worker 尚未設定 YOUTUBE_API_KEY"
          }
        },
        500,
        origin,
        allowedOrigin
      );
    }

    const ip =
      request.headers.get(
        "CF-Connecting-IP"
      ) ||
      "unknown";

    if (
      await isRateLimited(
        ip
      )
    ) {
      return jsonResponse(
        {
          error: {
            message:
              "搜尋太頻繁，請稍候再試"
          }
        },
        429,
        origin,
        allowedOrigin
      );
    }

    const query =
      String(
        url.searchParams.get("q") ||
        ""
      ).trim();

    if (
      !query ||
      query.length >
        100
    ) {
      return jsonResponse(
        {
          error: {
            message:
              "搜尋關鍵字格式錯誤"
          }
        },
        400,
        origin,
        allowedOrigin
      );
    }

    const maxResults =
      Math.min(
        25,
        Math.max(
          1,
          Number(
            url.searchParams.get(
              "maxResults"
            ) || 25
          )
        )
      );

    const pageToken =
      String(
        url.searchParams.get(
          "pageToken"
        ) || ""
      ).trim();

    const cache =
      caches.default;

    const cacheKey =
      new Request(
        url.toString(),
        {
          method:
            "GET"
        }
      );

    const cached =
      await cache.match(
        cacheKey
      );

    if (cached) {
      return cached;
    }

    const youtubeUrl =
      new URL(
        "https://www.googleapis.com/youtube/v3/search"
      );

    youtubeUrl.searchParams.set(
      "part",
      "snippet"
    );

    youtubeUrl.searchParams.set(
      "q",
      query
    );

    youtubeUrl.searchParams.set(
      "type",
      "video"
    );

    youtubeUrl.searchParams.set(
      "maxResults",
      String(
        maxResults
      )
    );

    youtubeUrl.searchParams.set(
      "regionCode",
      "TW"
    );

    youtubeUrl.searchParams.set(
      "relevanceLanguage",
      "zh-Hant"
    );

    youtubeUrl.searchParams.set(
      "safeSearch",
      "moderate"
    );

    youtubeUrl.searchParams.set(
      "videoEmbeddable",
      "true"
    );

    if (pageToken) {
      youtubeUrl.searchParams.set(
        "pageToken",
        pageToken
      );
    }

    youtubeUrl.searchParams.set(
      "key",
      apiKey
    );

    const response =
      await fetch(
        youtubeUrl.toString()
      );

    if (!response.ok) {
      const errorBody =
        await response.text();

      return jsonResponse(
        {
          error: {
            message:
              "YouTube API 請求失敗",
            details:
              errorBody.slice(
                0,
                1000
              )
          }
        },
        response.status,
        origin,
        allowedOrigin
      );
    }

    const data =
      await response.json();

    const items =
      Array.isArray(
        data.items
      )
        ? data.items
        : [];

    const result = {
      items:
        items.map(
          (item) => {
            const id =
              item?.id?.videoId;

            const snippet =
              item?.snippet ||
              {};

            return {
              id: {
                videoId:
                  id || ""
              },
              snippet
            };
          }
        ),
      nextPageToken:
        data?.nextPageToken ||
        ""
    };

    const responseBody =
      new Response(
        JSON.stringify(
          result
        ),
        {
          status: 200,
          headers: {
            "Content-Type":
              "application/json; charset=utf-8",
            "Cache-Control":
              `public, max-age=${CACHE_TTL_SECONDS}`,
            ...corsHeaders(
              origin,
              allowedOrigin
            )
          }
        }
      );

    ctx.waitUntil(
      cache.put(
        cacheKey,
        responseBody.clone()
      )
    );

    return responseBody;
  }
};
