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
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/portal/.output ./.output
USER node
EXPOSE 3001
CMD ["node", ".output/server/index.mjs"]
