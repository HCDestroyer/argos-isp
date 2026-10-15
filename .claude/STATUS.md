# STATUS.md — Estado diario

Cada líder, al final del día, tres líneas por agente.

## 2026-10-15 · Día 1 adelantado (líderes y PM)

### Líder BE
- Hecho: `apps/api` en AdonisJS 6: migraciones de los seis schemas (cuadre del libro por trigger diferido, ledger y audit inmutables, audit particionado por mes, rol `argosisp_app`), `DomainAction` con auditoría y outbox, errores RFC 9457, `Idempotency-Key`, `X-Request-Id`, paginación por cursor, login, logout y `/me`, seed de 55 permisos y 6 roles, OpenAPI con 78 operaciones (501 donde falta handler) y `packages/contracts` regenerado. 41 pruebas Japa contra Postgres real.
- Bloqueado: nada.
- Siguiente: revisar PRs de A1, A2 y A3.

### Líder FE
- Hecho: `apps/web` (layout de dashboard, login, menú por permisos, fixtures, formato GTQ y America/Guatemala, badge de estados) y `apps/portal` (móvil primero, sin recursos externos, `/corte` placeholder). 22 y 12 pruebas Vitest; capturas a 390 y 1280 px en claro y oscuro.
- Bloqueado: nada.
- Siguiente: revisar PRs de A4 y A5.

### PM
- Hecho: `infra/docker-compose.yml` (Postgres, Redis, Mailpit, migrate, api, web, portal; perfil `lab` con FreeRADIUS 3.2.10, aaa y coa), CI en GitHub Actions, esqueletos de `services/aaa` y `services/coa`, FreeRADIUS con `rlm_rest`, `infra/mikrotik/lab.rsc` probado en RouterOS 7.24.5 (CHR). Compose verificado de punta a punta: migrate, seed, api healthy, login y `/me`.
- Bloqueado: nada.
- Siguiente: aplicar `lab.rsc` en el MikroTik físico, crear `infra/.env`, pedir sandbox de INFILE y credenciales de la pasarela (anotar fechas aquí).

## 2026-10-20

### A1
- Hecho:
- Bloqueado:
- Siguiente:

### A2
- Hecho:
- Bloqueado:
- Siguiente:

### A3
- Hecho:
- Bloqueado:
- Siguiente:

### A4
- Hecho:
- Bloqueado:
- Siguiente:

### A5
- Hecho:
- Bloqueado:
- Siguiente:

### A6
- Hecho:
- Bloqueado:
- Siguiente:
