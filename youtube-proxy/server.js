const http = require("node:http");
const { spawn } = require("node:child_process");

const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const cache = new Map();
const CACHE_TTL_MS = 90_000;
const SEARCH_CACHE_TTL_MS = 30_000;
const MAX_SEARCH_RESULTS = 25;
const MAX_SEARCH_BATCH = 50;
const SEARCH_TIMEOUT_MS = 30_000;

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
    "Access-Control-Allow-Headers": "Range,Content-Type",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function youtubeUrl(videoId) {
  return "https://www.youtube.com/watch?v=" + encodeURIComponent(videoId);
}

function parseSearchPage(pageToken) {
  const page = Number(pageToken || "1");
  if (!Number.isInteger(page) || page < 1 || page > 2) {
    return 1;
  }
  return page;
}

function makeSearchCacheKey(query, maxResults, page) {
  return JSON.stringify({
    query,
    maxResults,
    page
  });
}

function getStreamUrl(videoId) {
  const cached = cache.get(videoId);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.url);
  }

  return new Promise((resolve, reject) => {
    const args = [
      "--no-playlist",
      "--no-warnings",
      "--no-progress",
      "--skip-download",
      "--get-url",
      "--js-runtimes",
      "node",
      "--socket-timeout",
      "20",
      "-f",
      "b[ext=mp4]/b",
      youtubeUrl(videoId)
    ];

    const child = spawn("yt-dlp", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1"
      }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("yt-dlp timeout"));
    }, 30_000);

    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", code => {
      clearTimeout(timer);

      const url = stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .find(line => /^https?:\/\//i.test(line));

      if (code !== 0 || !url) {
        const details = stderr.trim().slice(-1600);
        reject(new Error(details || "yt-dlp failed"));
        return;
      }

      cache.set(videoId, {
        url,
        expiresAt: Date.now() + CACHE_TTL_MS
      });

      resolve(url);
    });
  });
}

function runYoutubeSearch(query, maxResults, page) {
  const cacheKey = makeSearchCacheKey(
    query,
    maxResults,
    page
  );

  const cached = cache.get("search:" + cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return Promise.resolve(cached.data);
  }

  return new Promise((resolve, reject) => {
    const start =
      page === 2
        ? maxResults + 1
        : 1;

    const end =
      page === 2
        ? MAX_SEARCH_BATCH
        : maxResults;

    const args = [
      "--quiet",
      "--no-warnings",
      "--no-progress",
      "--skip-download",
      "--flat-playlist",
      "--dump-json",
      "--ignore-errors",
      "--playlist-start",
      String(start),
      "--playlist-end",
      String(end),
      "--socket-timeout",
      "20",
      "--js-runtimes",
      "node",
      "--extractor-args",
      "youtube:player_client=web,web_embedded,mweb",
      "ytsearch" + String(MAX_SEARCH_BATCH) + ":" + query
    ];

    const child = spawn("yt-dlp", args, {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1"
      }
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", chunk => {
      stderr += chunk.toString();
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("YouTube search timeout"));
    }, SEARCH_TIMEOUT_MS);

    child.on("error", error => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", code => {
      clearTimeout(timer);

      const lines = stdout
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean);

      const entries = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          if (
            entry &&
            typeof entry === "object"
          ) {
            entries.push(entry);
          }
        } catch (_) {}
      }

      if (
        code !== 0 &&
        entries.length === 0
      ) {
        const details =
          stderr.trim().slice(-1600);

        reject(
          new Error(
            details ||
            "YouTube search failed"
          )
        );

        return;
      }

      const items = entries
        .map(entry => {
          const rawId =
            entry?.id ||
            entry?.url ||
            "";

          const id =
            String(rawId || "").trim();

          if (!VIDEO_ID_RE.test(id)) {
            return null;
          }

          const duration =
            Number(entry?.duration || 0);

          const viewCount =
            Number(entry?.view_count || 0);

          const thumbnail =
            entry?.thumbnail ||
            "https://i.ytimg.com/vi/" +
              id +
              "/hqdefault.jpg";

          return {
            id: {
              videoId: id
            },
            snippet: {
              title:
                entry?.title ||
                "未命名影片",
              description:
                entry?.description ||
                "",
              channelTitle:
                entry?.channel ||
                entry?.uploader ||
                entry?.channel_id ||
                "YouTube",
              publishedAt:
                entry?.upload_date
                  ? String(entry.upload_date).replace(
                      /^(\d{4})(\d{2})(\d{2})$/,
                      "$1-$2-$3T00:00:00Z"
                    )
                  : "",
              liveBroadcastContent:
                entry?.live_status === "is_live"
                  ? "live"
                  : "none",
              thumbnails: {
                default: {
                  url: thumbnail,
                  width: 120,
                  height: 90
                },
                medium: {
                  url: thumbnail,
                  width: 320,
                  height: 180
                },
                high: {
                  url: thumbnail,
                  width: 480,
                  height: 360
                },
                maxres: {
                  url: thumbnail,
                  width: 1280,
                  height: 720
                }
              }
            },
            viewCount:
              Number.isFinite(viewCount)
                ? viewCount
                : 0,
            likeCount: 0,
            duration:
              Number.isFinite(duration)
                ? "PT" +
                  Math.floor(duration) +
                  "S"
                : "",
            durationSeconds:
              Number.isFinite(duration)
                ? duration
                : 0
          };
        })
        .filter(Boolean)
        .filter(
          (item, index, array) =>
            array.findIndex(
              candidate =>
                candidate.id.videoId ===
                item.id.videoId
            ) === index
        )
        .slice(0, maxResults);

      const result = {
        items,
        nextPageToken:
          page === 1 &&
          entries.length >= maxResults
            ? "2"
            : ""
      };

      cache.set("search:" + cacheKey, {
        data: result,
        expiresAt: Date.now() + SEARCH_CACHE_TTL_MS
      });

      resolve(result);
    });
  });
}

async function handleSearch(req, res, url) {
  const query = String(
    url.searchParams.get("q") || ""
  ).trim();

  if (!query || query.length > 100) {
    send(res, 400, JSON.stringify({
      error: {
        message: "搜尋關鍵字格式錯誤"
      }
    }));
    return;
  }

  const requested = Number(
    url.searchParams.get("maxResults") || MAX_SEARCH_RESULTS
  );

  const maxResults = Number.isFinite(requested)
    ? Math.min(
        MAX_SEARCH_RESULTS,
        Math.max(1, Math.floor(requested))
      )
    : MAX_SEARCH_RESULTS;

  const page = parseSearchPage(
    url.searchParams.get("pageToken")
  );

  try {
    const result = await runYoutubeSearch(
      query,
      maxResults,
      page
    );

    send(
      res,
      200,
      JSON.stringify(result)
    );
  } catch (error) {
    console.error(
      "[search]",
      query,
      error?.message || error
    );

    send(res, 502, JSON.stringify({
      error: {
        message: "YouTube 搜尋失敗"
      }
    }));
  }
}

async function handleStream(req, res, videoId) {
  try {
    const url = await getStreamUrl(videoId);

    res.writeHead(302, {
      Location: url,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "Range,Content-Type",
      "Cache-Control": "no-store"
    });
    res.end();
  } catch (error) {
    console.error("[stream]", videoId, error?.message || error);
    send(res, 502, JSON.stringify({
      error: "youtube_stream_unavailable",
      message: "Unable to resolve a playable YouTube stream right now."
    }));
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,HEAD,OPTIONS",
      "Access-Control-Allow-Headers": "Range,Content-Type"
    });
    res.end();
    return;
  }

  const url = new URL(
    req.url,
    "http://" + (req.headers.host || "localhost")
  );

  if (url.pathname === "/health") {
    send(res, 200, JSON.stringify({
      ok: true,
      service: "watchtogether-youtube-proxy"
    }));
    return;
  }

  if (url.pathname === "/search") {
    if (req.method !== "GET") {
      send(res, 405, JSON.stringify({
        error: "method_not_allowed"
      }));
      return;
    }

    handleSearch(req, res, url);
    return;
  }

  if (url.pathname === "/stream") {
    const videoId = url.searchParams.get("v") || "";

    if (!VIDEO_ID_RE.test(videoId)) {
      send(res, 400, JSON.stringify({
        error: "invalid_video_id"
      }));
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      send(res, 405, JSON.stringify({
        error: "method_not_allowed"
      }));
      return;
    }

    handleStream(req, res, videoId);
    return;
  }

  send(res, 404, JSON.stringify({
    error: "not_found"
  }));
});

server.listen(PORT, HOST, () => {
  console.log("YouTube proxy listening on " + HOST + ":" + PORT);
});
