# syntax=docker/dockerfile:1.7
# Panel de administración (@argosisp/web). El contexto de build es la raíz del monorepo:
#   docker build -f apps/web/Dockerfile -t argosisp/web .
# Variables en tiempo de ejecución: NUXT_PUBLIC_API_BASE, NUXT_PUBLIC_USE_FIXTURES, PORT.

FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/web/package.json apps/web/
# --ignore-scripts: el postinstall (nuxt prepare) necesita el código, que aún no está copiado.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter "@argosisp/web..."

FROM deps AS build
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/web apps/web
RUN pnpm --filter @argosisp/web build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.output ./.output
USER node
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
