# syntax=docker/dockerfile:1.7
# Portal del cliente y página de corte (@argosisp/portal). El contexto de build es la raíz del monorepo:
#   docker build -f apps/portal/Dockerfile -t argosisp/portal .
# Variables en tiempo de ejecución (ver .env.example): NUXT_API_BASE_INTERNAL, NUXT_PUBLIC_API_BASE, NUXT_PUBLIC_USE_FIXTURES,
# NUXT_PUBLIC_EMPRESA_*, NUXT_PUBLIC_DEPOSITO_*, PORT.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/portal/package.json apps/portal/
# --ignore-scripts: el postinstall (nuxt prepare) necesita el código, que aún no está copiado.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter "@argosisp/portal..."

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/portal apps/portal
RUN pnpm --filter @argosisp/portal build

FROM node:22-alpine AS runtime
# Sin gestores de paquetes en la imagen final (solo node): ni npm, ni corepack, ni yarn.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack /opt/yarn-* \
    /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack /usr/local/bin/yarn /usr/local/bin/yarnpkg
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/portal/.output ./.output
# Versión de la imagen (workflow imagenes.yml): la API la expone en GET /api/v1/version y
# `argosisp actualizar` la compara con la publicada. Va al final para no invalidar la caché del build.
ARG ARGOSISP_VERSION=desarrollo
ARG ARGOSISP_COMMIT=
ARG ARGOSISP_COMPILADA=
ENV ARGOSISP_VERSION=$ARGOSISP_VERSION \
    ARGOSISP_COMMIT=$ARGOSISP_COMMIT \
    ARGOSISP_COMPILADA=$ARGOSISP_COMPILADA
USER node
EXPOSE 3001
CMD ["node", ".output/server/index.mjs"]
