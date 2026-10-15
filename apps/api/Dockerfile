# syntax=docker/dockerfile:1.7
#
# Imagen de @argosisp/api. El contexto de build es la RAÍZ del monorepo:
#
#   docker build -f apps/api/Dockerfile -t argosisp/api .
#
# Variables en tiempo de ejecución: ver apps/api/.env.example (DB_*, APP_KEY, INTERNAL_TOKEN…).
# RUN_MIGRATIONS=true ejecuta `migration:run --force` antes de arrancar.

ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-alpine AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo

# ---------------------------------------------------------------------------
# build: instala el workspace, compila y genera un directorio desplegable
# ---------------------------------------------------------------------------
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @argosisp/api...
RUN pnpm --filter @argosisp/api build
# /out: package.json + node_modules de producción + build/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @argosisp/api deploy --prod --legacy /out

# ---------------------------------------------------------------------------
# runtime
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION}-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3333 \
    LOG_LEVEL=info \
    RUN_MIGRATIONS=false
WORKDIR /app
COPY --from=build --chown=node:node /out /app
COPY --chown=node:node apps/api/docker-entrypoint.sh /app/docker-entrypoint.sh
USER node
EXPOSE 3333
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3333)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
