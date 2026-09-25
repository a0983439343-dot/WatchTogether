FROM brainicism/bgutil-ytdlp-pot-provider:2.0.0-node AS bgutil

FROM node:26-bookworm-slim

ENV NODE_ENV=production
ENV PATH="/opt/ytvenv/bin:$PATH"

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN python3 -m venv /opt/ytvenv \
  && /opt/ytvenv/bin/pip install --no-cache-dir -U "yt-dlp[default,curl-cffi]" "bgutil-ytdlp-pot-provider==2.0.0"

COPY --from=bgutil /app/build /opt/bgutil/build
COPY --from=bgutil /app/node_modules /opt/bgutil/node_modules

WORKDIR /app

COPY package.json ./package.json
COPY server.js ./server.js
COPY start.sh ./start.sh

RUN chmod +x ./start.sh

CMD ["./start.sh"]
