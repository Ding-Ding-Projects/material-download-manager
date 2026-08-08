FROM node:24.11.1-bookworm-slim AS dependencies

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund

FROM dependencies AS build

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24.11.1-bookworm-slim AS production-dependencies

WORKDIR /build
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
    && npm cache clean --force

FROM node:24.11.1-bookworm-slim AS runtime

LABEL org.opencontainers.image.title="Material Download Manager SSH range worker" \
      org.opencontainers.image.description="Restricted SSH worker for verified HTTP byte ranges" \
      org.opencontainers.image.licenses="MIT" \
      com.material-download-manager.owner="material-download-manager" \
      com.material-download-manager.component="ssh-range-worker"

ENV NODE_ENV=production \
    MDM_WORKER_BIND_HOST=0.0.0.0 \
    MDM_WORKER_PORT=2222 \
    MDM_WORKER_STATE_DIR=/var/lib/mdm-worker

RUN groupadd --gid 10001 mdmworker \
    && useradd --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin mdmworker \
    && install -d -o 10001 -g 10001 -m 0700 /var/lib/mdm-worker \
    && install -d -o 10001 -g 10001 -m 0755 /opt/mdm-worker

WORKDIR /opt/mdm-worker
COPY --from=production-dependencies --chown=10001:10001 /build/node_modules ./node_modules
COPY --from=production-dependencies --chown=10001:10001 /build/package.json ./package.json
COPY --from=build --chown=10001:10001 /build/dist ./dist

VOLUME ["/var/lib/mdm-worker"]
EXPOSE 2222/tcp
USER 10001:10001

HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD ["node", "dist/healthcheck.js"]

ENTRYPOINT ["node", "dist/cli.js"]
