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
# Sin gestores de paquetes en la imagen final (solo node): ni npm, ni corepack, ni yarn.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3333 \
    LOG_LEVEL=info \
    RUN_MIGRATIONS=false
WORKDIR /app
COPY --from=build --chown=node:node /out /app
COPY --chown=node:node apps/api/docker-entrypoint.sh /app/docker-entrypoint.sh
# "Qué cambió" de GET /api/v1/version (app/monitoreo/version.ts)
COPY --chown=node:node CHANGELOG.md /app/CHANGELOG.md
# Script de conexión de routers (app/network/conexion/render.ts, contratos/conexion-routers.md §6.2):
# patrones y plantillas armadas de infra/mikrotik. Sin ellos, GET /routers/:id/script-conexion
# responde 503 plantillas_no_disponibles. Las piezas no hacen falta: las plantillas ya vienen armadas.
COPY --chown=node:node infra/mikrotik/variables.json /app/mikrotik/variables.json
COPY --chown=node:node infra/mikrotik/plantillas/ /app/mikrotik/plantillas/
ENV ROUTERS_MIKROTIK_DIR=/app/mikrotik
# Versión de la imagen (workflow imagenes.yml): la API la expone en GET /api/v1/version y
# `argosisp actualizar` la compara con la publicada. Va al final para no invalidar la caché del build.
ARG ARGOSISP_VERSION=desarrollo
ARG ARGOSISP_COMMIT=
ARG ARGOSISP_COMPILADA=
ENV ARGOSISP_VERSION=$ARGOSISP_VERSION \
    ARGOSISP_COMMIT=$ARGOSISP_COMMIT \
    ARGOSISP_COMPILADA=$ARGOSISP_COMPILADA
USER node
EXPOSE 3333
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3333)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["sh", "/app/docker-entrypoint.sh"]
