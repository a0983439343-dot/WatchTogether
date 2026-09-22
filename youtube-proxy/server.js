const http = require("node:http");
const { spawn } = require("node:child_process");

const PORT = Number(process.env.PORT || 10000);
const HOST = "0.0.0.0";
const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const cache = new Map();
const CACHE_TTL_MS = 90_000;

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
        const details = stderr.trim().slice(-1200);
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

  const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));

  if (url.pathname === "/health") {
    send(res, 200, JSON.stringify({
      ok: true,
      service: "watchtogether-youtube-proxy"
    }));
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
