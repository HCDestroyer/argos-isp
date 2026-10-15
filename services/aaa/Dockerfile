# syntax=docker/dockerfile:1
# Build context = raíz del repo:  docker build -f services/aaa/Dockerfile .
# Las exclusiones del contexto están en services/aaa/Dockerfile.dockerignore (BuildKit).

ARG NODE_IMAGE=node:22.23.3-alpine

FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY services/aaa/package.json services/aaa/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @argosisp/aaa...
COPY services/aaa services/aaa
RUN pnpm --filter @argosisp/aaa build \
    && pnpm --filter @argosisp/aaa deploy --legacy --prod /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production PORT=3100
WORKDIR /app
COPY --from=build --chown=node:node /out/package.json ./package.json
COPY --from=build --chown=node:node /out/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/services/aaa/dist ./dist
USER node
EXPOSE 3100
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3100)+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "dist/index.js"]
