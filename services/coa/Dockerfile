# syntax=docker/dockerfile:1
# Build context = raíz del repo:  docker build -f services/coa/Dockerfile .
# Las exclusiones del contexto están en services/coa/Dockerfile.dockerignore (BuildKit).

ARG NODE_IMAGE=node:22.23.3-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY services/coa/package.json services/coa/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @argosisp/coa...
COPY services/coa services/coa
RUN pnpm --filter @argosisp/coa build \
    && pnpm --filter @argosisp/coa deploy --legacy --prod /out

FROM ${NODE_IMAGE} AS runtime
# Sin gestores de paquetes en la imagen final (solo node): ni npm, ni corepack, ni yarn.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production PORT=3200
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/services/coa/dist ./dist
COPY --from=build --chown=node:node /repo/services/coa/diccionarios ./diccionarios
# Versión de la imagen (workflow imagenes.yml): la API la expone en GET /api/v1/version y
# `argosisp actualizar` la compara con la publicada. Va al final para no invalidar la caché del build.
ARG ARGOSISP_VERSION=desarrollo
ARG ARGOSISP_COMMIT=
ARG ARGOSISP_COMPILADA=
ENV ARGOSISP_VERSION=$ARGOSISP_VERSION \
    ARGOSISP_COMMIT=$ARGOSISP_COMMIT \
    ARGOSISP_COMPILADA=$ARGOSISP_COMPILADA
USER node
EXPOSE 3200
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3200)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
