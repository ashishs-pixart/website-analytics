FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      ca-certificates \
      dbus-x11 \
      fluxbox \
      novnc \
      websockify \
      xauth \
      xvfb \
      x11vnc \
      libasound2 \
      libatk-bridge2.0-0 \
      libatk1.0-0 \
      libcups2 \
      libdbus-1-3 \
      libdrm2 \
      libgbm1 \
      libgtk-3-0 \
      libnss3 \
      libx11-xcb1 \
      libxcb-dri3-0 \
      libxcomposite1 \
      libxdamage1 \
      libxfixes3 \
      libxkbcommon0 \
      libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

ENV DISPLAY=:99
ENV ELECTRON_DISABLE_GPU=1
ENV NO_AT_BRIDGE=1
ENV NOVNC_PORT=6080
ENV VNC_PORT=5900

EXPOSE 6080 5900

CMD ["docker-entrypoint.sh"]
