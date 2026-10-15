# @argosisp/contracts

OpenAPI de `apps/api` y tipos TypeScript para los frontends. **No se edita a mano.**

- `openapi.json`: generado por `pnpm --filter @argosisp/api openapi:generate`.
- `src/schema.d.ts`: generado desde `openapi.json` con `openapi-typescript`.
- `src/index.ts`: `createApiClient()` (openapi-fetch con token Bearer) y helpers de tipos `Schema<'X'>`, `Problem`.

Regenerar todo desde la raíz: `pnpm contracts:build`. CI falla si el resultado difiere de lo commiteado.
