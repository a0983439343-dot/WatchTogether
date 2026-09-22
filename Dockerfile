FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV PATH="/root/.deno/bin:/opt/ytvenv/bin:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/ytvenv \
  && /opt/ytvenv/bin/pip install --no-cache-dir -U "yt-dlp[default]"

RUN curl -fsSL https://deno.land/install.sh | sh

WORKDIR /app

COPY youtube-proxy/package.json ./package.json
COPY youtube-proxy/server.js ./server.js

CMD ["node", "server.js"]
