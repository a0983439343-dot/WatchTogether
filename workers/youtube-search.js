/*
 * WatchTogether - YouTube Search Proxy
 *
 * Deploy this file as a Cloudflare Worker.
 *
 * Required Worker secrets / variables:
 *   YOUTUBE_API_KEY=<new YouTube Data API key>
 *   FIREBASE_PROJECT_ID=watchtogether-3f4f9
 *   ALLOWED_ORIGIN=https://a0983439343-dot.github.io
 *
 * The browser NEVER receives the YouTube API key.
 *
 * The Worker requires a Firebase Auth ID token and verifies it
 * against Google's Secure Token certificates before allowing
 * a YouTube API request.
 */

const DEFAULT_ALLOWED_ORIGIN =
  "https://a0983439343-dot.github.io";

const DEFAULT_FIREBASE_PROJECT_ID =
  "watchtogether-3f4f9";

const CACHE_TTL_SECONDS = 30;
const RATE_WINDOW_MS = 60 * 1000;
const IP_RATE_LIMIT = 20;
const USER_RATE_LIMIT = 12;
const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 25;

const ipBuckets =
  new Map();

const userBuckets =
  new Map();

const keyCache =
  new Map();

const certCache =
  {
    expiresAt: 0,
    certs: null
  };

function corsHeaders(
  origin,
  allowedOrigin
) {
  const allowed =
    allowedOrigin === "*"
      ? "*"
      : origin === allowedOrigin
        ? origin
        : allowedOrigin;

  return {
    "Access-Control-Allow-Origin":
      allowed,

    "Access-Control-Allow-Methods":
      "GET, OPTIONS",

    "Access-Control-Allow-Headers":
      "Accept, Authorization, Content-Type",

    "Vary":
      "Origin"
  };
}

function jsonResponse(
  body,
  status = 200,
  origin = "",
  allowedOrigin =
    DEFAULT_ALLOWED_ORIGIN
) {
  return new Response(
    JSON.stringify(body),
    {
      status,

      headers: {
        "Content-Type":
          "application/json; charset=utf-8",

        "Cache-Control":
          "no-store",

        ...corsHeaders(
          origin,
          allowedOrigin
        )
      }
    }
  );
}

function base64UrlToBytes(
  value
) {
  const normalized =
    String(value || "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");

  const padded =
    normalized +
    "=".repeat(
      (4 -
        (normalized.length %
          4)) %
        4
    );

  const binary =
    atob(padded);

  const bytes =
    new Uint8Array(
      binary.length
    );

  for (
    let i = 0;
    i < binary.length;
    i++
  ) {
    bytes[i] =
      binary.charCodeAt(i);
  }

  return bytes;
}

function decodeBase64UrlJson(
  value
) {
  const bytes =
    base64UrlToBytes(value);

  const text =
    new TextDecoder().decode(
      bytes
    );

  return JSON.parse(text);
}

function base64UrlToUint8Array(value) {
  const normalized =
    String(value || "")
      .replace(/-/g, "+")
      .replace(/_/g, "/");

  const padded =
    normalized +
    "=".repeat(
      (4 - (normalized.length % 4)) % 4
    );

  const binary =
    atob(padded);

  const bytes =
    new Uint8Array(
      binary.length
    );

  for (
    let i = 0;
    i < binary.length;
    i++
  ) {
    bytes[i] =
      binary.charCodeAt(i);
  }

  return bytes;
}

function parseMaxAge(cacheControl) {
  const match =
    String(
      cacheControl || ""
    ).match(
      /max-age=(\d+)/
    );

  if (!match) {
    return 3600;
  }

  return Math.max(
    300,
    Math.min(
      21600,
      Number(match[1])
    )
  );
}

async function getGoogleJwks() {
  const now =
    Date.now();

  if (
    certCache.certs &&
    now <
      certCache.expiresAt
  ) {
    return certCache.certs;
  }

  const response =
    await fetch(
      "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"
    );

  if (!response.ok) {
    throw new Error(
      "無法取得 Firebase 公開金鑰"
    );
  }

  const data =
    await response.json();

  certCache.certs =
    Array.isArray(data?.keys)
      ? data.keys
      : [];

  certCache.expiresAt =
    now +
    parseMaxAge(
      response.headers.get(
        "Cache-Control"
      )
    ) *
      1000;

  return certCache.certs;
}

async function getVerifyKey(kid) {
  if (
    keyCache.has(kid)
  ) {
    return keyCache.get(
      kid
    );
  }

  const jwks =
    await getGoogleJwks();

  let jwk =
    jwks.find(
      (item) =>
        item?.kid === kid
    );

  if (!jwk) {
    certCache.expiresAt =
      0;

    keyCache.clear();

    const refreshed =
      await getGoogleJwks();

    jwk =
      refreshed.find(
        (item) =>
          item?.kid === kid
      );
  }

  if (!jwk) {
    throw new Error(
      "Firebase 公開金鑰不存在"
    );
  }

  const key =
    await crypto.subtle.importKey(
      "jwk",
      {
        kty:
          "RSA",
        n:
          jwk.n,
        e:
          jwk.e,
        alg:
          "RS256",
        use:
          "sig"
      },
      {
        name:
          "RSASSA-PKCS1-v1_5",
        hash:
          "SHA-256"
      },
      false,
      [
        "verify"
      ]
    );

  keyCache.set(
    kid,
    key
  );

  return key;
}

async function verifyFirebaseIdToken(
  token,
  projectId
) {
  if (!token) {
    return null;
  }

  const parts =
    token.split(".");

  if (
    parts.length !== 3
  ) {
    throw new Error(
      "Firebase Token 格式錯誤"
    );
  }

  const header =
    decodeBase64UrlJson(
      parts[0]
    );

  const payload =
    decodeBase64UrlJson(
      parts[1]
    );

  if (
    header?.alg !==
      "RS256" ||
    !header?.kid
  ) {
    throw new Error(
      "Firebase Token 演算法錯誤"
    );
  }

  const now =
    Math.floor(
      Date.now() / 1000
    );

  if (
    !payload?.sub ||
    typeof payload.sub !==
      "string" ||
    payload.sub.length >
      128
  ) {
    throw new Error(
      "Firebase Token 使用者錯誤"
    );
  }

  if (
    payload.aud !==
      projectId
  ) {
    throw new Error(
      "Firebase Token 專案錯誤"
    );
  }

  if (
    payload.iss !==
      "https://securetoken.google.com/" +
        projectId
  ) {
    throw new Error(
      "Firebase Token 發行者錯誤"
    );
  }

  if (
    typeof payload.exp !==
      "number" ||
    payload.exp <= now
  ) {
    throw new Error(
      "Firebase Token 已過期"
    );
  }

  if (
    typeof payload.iat !==
      "number" ||
    payload.iat >
      now + 120 ||
    payload.iat <= 0
  ) {
    throw new Error(
      "Firebase Token 核發時間錯誤"
    );
  }

  if (
    typeof payload.auth_time !==
      "number" ||
    payload.auth_time >
      now + 120 ||
    payload.auth_time <= 0
  ) {
    throw new Error(
      "Firebase Token 驗證時間錯誤"
    );
  }

  const verifyKey =
    await getVerifyKey(
      header.kid
    );

  const encoder =
    new TextEncoder();

  const data =
    encoder.encode(
      parts[0] +
        "." +
        parts[1]
    );

  const signature =
    base64UrlToBytes(
      parts[2]
    );

  const valid =
    await crypto.subtle.verify(
      {
        name:
          "RSASSA-PKCS1-v1_5"
      },
      verifyKey,
      signature,
      data
    );

  if (!valid) {
    throw new Error(
      "Firebase Token 簽章驗證失敗"
    );
  }

  return payload;
}

function isRateLimited(
  bucketMap,
  key,
  limit
) {
  const now =
    Date.now();

  const record =
    bucketMap.get(
      key
    );

  if (
    !record ||
    now -
      record.start >=
      RATE_WINDOW_MS
  ) {
    bucketMap.set(
      key,
      {
        start:
          now,
        count:
          1
      }
    );

    return false;
  }

  record.count += 1;

  return (
    record.count >
    limit
  );
}

function parseIsoDuration(
  value
) {
  const text =
    String(
      value || ""
    );

  const match =
    text.match(
      /^PT(?:(\\d+)H)?(?:(\\d+)M)?(?:(\\d+)S)?$/
    );

  if (!match) {
    return 0;
  }

  return (
    Number(
      match[1] || 0
    ) *
      3600 +
    Number(
      match[2] || 0
    ) *
      60 +
    Number(
      match[3] || 0
    )
  );
}

export default {
  async fetch(
    request,
    env,
    ctx
  ) {
    const url =
      new URL(
        request.url
      );

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
          status:
            204,
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

    const authorization =
      request.headers.get(
        "Authorization"
      ) || "";

    const tokenMatch =
      authorization.match(
        /^Bearer\\s+(.+)$/i
      );

    if (!tokenMatch) {
      return jsonResponse(
        {
          error: {
            message:
              "缺少登入驗證"
          }
        },
        401,
        origin,
        allowedOrigin
      );
    }

    const projectId =
      String(
        env.FIREBASE_PROJECT_ID ||
        DEFAULT_FIREBASE_PROJECT_ID
      ).trim();

    let firebaseUser = null;

    try {
      firebaseUser =
        await verifyFirebaseIdToken(
          tokenMatch[1],
          projectId
        );
    } catch (error) {
      return jsonResponse(
        {
          error: {
            message:
              "登入驗證失敗"
          }
        },
        401,
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
      isRateLimited(
        ipBuckets,
        ip,
        IP_RATE_LIMIT
      ) ||
      isRateLimited(
        userBuckets,
        firebaseUser.sub,
        USER_RATE_LIMIT
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
        url.searchParams.get(
          "q"
        ) || ""
      ).trim();

    if (
      !query ||
      query.length >
        MAX_QUERY_LENGTH
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

    const requestedMaxResults =
      Number(
        url.searchParams.get(
          "maxResults"
        ) || MAX_RESULTS
      );

    const maxResults =
      Number.isFinite(
        requestedMaxResults
      )
        ? Math.min(
            MAX_RESULTS,
            Math.max(
              1,
              Math.floor(
                requestedMaxResults
              )
            )
          )
        : MAX_RESULTS;

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
        "https://cache.watchtogether.local/youtube-search?" +
          new URLSearchParams({
            q:
              query,
            maxResults:
              String(
                maxResults
              ),
            regionCode:
              "TW",
            relevanceLanguage:
              "zh-Hant",
            safeSearch:
              "moderate",
            videoEmbeddable:
              "true",
            pageToken:
              pageToken
          }).toString()
      );

    const cached =
      await cache.match(
        cacheKey
      );

    if (cached) {
      return cached;
    }

    const youtubeSearchUrl =
      new URL(
        "https://www.googleapis.com/youtube/v3/search"
      );

    youtubeSearchUrl.searchParams.set(
      "part",
      "snippet"
    );

    youtubeSearchUrl.searchParams.set(
      "q",
      query
    );

    youtubeSearchUrl.searchParams.set(
      "type",
      "video"
    );

    youtubeSearchUrl.searchParams.set(
      "maxResults",
      String(
        maxResults
      )
    );

    youtubeSearchUrl.searchParams.set(
      "regionCode",
      "TW"
    );

    youtubeSearchUrl.searchParams.set(
      "relevanceLanguage",
      "zh-Hant"
    );

    youtubeSearchUrl.searchParams.set(
      "safeSearch",
      "moderate"
    );

    youtubeSearchUrl.searchParams.set(
      "videoEmbeddable",
      "true"
    );

    if (pageToken) {
      youtubeSearchUrl.searchParams.set(
        "pageToken",
        pageToken
      );
    }

    youtubeSearchUrl.searchParams.set(
      "key",
      apiKey
    );

    const response =
      await fetch(
        youtubeSearchUrl.toString()
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

    const ids =
      items
        .map(
          (item) =>
            item?.id?.videoId
        )
        .filter(Boolean);

    let detailsById =
      {};

    if (ids.length) {
      const detailsUrl =
        new URL(
          "https://www.googleapis.com/youtube/v3/videos"
        );

      detailsUrl.searchParams.set(
        "part",
        "contentDetails,statistics"
      );

      detailsUrl.searchParams.set(
        "id",
        ids.join(",")
      );

      detailsUrl.searchParams.set(
        "key",
        apiKey
      );

      const detailsResponse =
        await fetch(
          detailsUrl.toString()
        );

      if (
        detailsResponse.ok
      ) {
        const detailsData =
          await detailsResponse.json();

        for (
          const item of
            Array.isArray(
              detailsData?.items
            )
              ? detailsData.items
              : []
        ) {
          detailsById[
            item.id
          ] =
            item;
        }
      }
    }

    const result = {
      items:
        items.map(
          (item) => {
            const id =
              item?.id?.videoId ||
              "";

            const detail =
              detailsById[id] ||
              {};

            const statistics =
              detail.statistics ||
              {};

            const contentDetails =
              detail.contentDetails ||
              {};

            return {
              id: {
                videoId:
                  id
              },

              snippet:
                item?.snippet ||
                {},

              viewCount:
                Number(
                  statistics.viewCount ||
                    0
                ),

              likeCount:
                Number(
                  statistics.likeCount ||
                    0
                ),

              duration:
                contentDetails.duration ||
                "",

              durationSeconds:
                parseIsoDuration(
                  contentDetails.duration
                )
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
          status:
            200,

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
