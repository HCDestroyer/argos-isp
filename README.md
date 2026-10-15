# ArgosIsp

Sistema de gestión para un ISP en Guatemala: clientes, servicios PPPoE dual-stack con RADIUS, facturación con libro de doble partida, cobros, promesas, corte y reactivación automáticos.

Reglas del repositorio en [`.claude/CLAUDE.md`](.claude/CLAUDE.md), plan en [`.claude/PLAN.md`](.claude/PLAN.md), agentes en [`.claude/agents/`](.claude/agents/).

## Monorepo

| Carpeta | Paquete |
| --- | --- |
| `apps/api` | `@argosisp/api` · AdonisJS 6, API REST, workers y crons |
| `apps/web` | `@argosisp/web` · panel de administración (Nuxt 4 + Nuxt UI) |
| `apps/portal` | `@argosisp/portal` · portal del cliente y página de corte |
| `services/aaa` | `@argosisp/aaa` · authorize/accounting para FreeRADIUS |
| `services/coa` | `@argosisp/coa` · CoA/Disconnect al NAS |
| `packages/contracts` | `@argosisp/contracts` · OpenAPI y tipos generados |
| `infra/` | docker-compose, CI, MikroTik del laboratorio |

## Comandos

```
pnpm install
docker compose -f infra/docker-compose.yml up -d postgres redis
pnpm lint && pnpm typecheck && pnpm test
pnpm contracts:build
```

Node 22 LTS y pnpm 10.
