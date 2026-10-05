# syntax=docker/dockerfile:1

# ---- build: compile the client and bundle the server into one file ----
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json vite.config.ts ./
COPY client ./client
COPY server ./server
COPY shared ./shared
RUN npm run build

# ---- runtime: node + the bundle, nothing else ----
FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    REFRAME_PORT=8787 \
    REFRAME_DATA_DIR=/app/data \
    REFRAME_PUBLIC_DIR=/app/dist/public \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning
WORKDIR /app
# The bundle has no runtime node_modules: every dependency is inlined by esbuild.
COPY --from=build --chown=node:node /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data && chmod 700 /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.REFRAME_PORT+'/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
LABEL org.opencontainers.image.title="reframe" \
      org.opencontainers.image.description="Self-hosted, encrypted-at-rest thought record journal" \
      org.opencontainers.image.source="https://github.com/therebelrobot/reframe" \
      org.opencontainers.image.licenses="Unlicense"
CMD ["node", "dist/server.mjs"]
