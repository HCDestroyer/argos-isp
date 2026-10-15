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

## 2026-10-15 · Día 2 adelantado (agentes A1 a A6, PRs #3 a #8 mergeadas)

### A1
- Hecho: tareas 1 a 6: ACL completo (usuarios, roles, tokens `atk_`, alcance router/zona/caja), clientes con NIT/CUI, routers y redes IPv4, planes, servicios con IPv4 + /64 + /56 y eventos. Corrigió el CHECK de coordenadas del día 1. 100 pruebas.
- Bloqueado: nada.
- Siguiente: tareas 8 a 10 (endpoints de estado, `aaa:user:*` + endpoint interno, relay de outbox) y filtros avanzados.

### A2
- Hecho: tareas 1 a 3: `/aaa/authorize` con Redis y respaldo a la API, `pnpm aaa:clients`, radtest PAP/CHAP en Docker para todos los estados.
- Bloqueado: endpoint interno y Redis de A1 (usa fixtures).
- Siguiente: tareas 4 a 6 (accounting, coa-dispatcher; reactivar con Disconnect).

### A3
- Hecho: tareas 1 a 3: plan de cuentas, `registrarAsiento`/`revertirAsiento` con cuadre visible, plantillas con reglas de promesa.
- Bloqueado: nada (`cambiarEstadoServicio` adelantado por el líder BE).
- Siguiente: tareas 4 a 7 (facturas, vencimiento, `evaluarEstadoServicio`, cron de corte), cobro rápido y estado de cuenta.

### A4
- Hecho: pantallas 1 a 4: lista, ficha, alta/edición de cliente y asistente de alta de servicio. 71 pruebas. Probadas contra la API real con datos de demostración.
- Bloqueado: estado de cuenta (501 hasta A3).
- Siguiente: filtros avanzados, lista y ficha de servicio, cobro rápido; corregir los fallos de las capturas 06 y 07.

### A5
- Hecho: tareas 1 a 3: `/corte`, captive portal, `quien-soy` por IPv4/IPv6 con proxy en el mismo origen.
- Bloqueado: nada.
- Siguiente: límite de peticiones en `quien-soy`, botón de pago apagado, estado en vivo.

### A6
- Hecho: tareas 5 y 6: notificaciones por correo y Telegram (los dos canales, decisión del PM), recordatorios; compose para aaa y portal.
- Bloqueado: relay de A1 para recibir eventos reales.
- Siguiente: importador de Mikrowisp en seco.

### Líderes y PM
- Hecho: integración de las 6 ramas; preparación del día 3 (`cambiarEstadoServicio`, `.claude/integration/` por agente, contratos de `aaa` y del bus de eventos, reglas de trabajo en paralelo en `CLAUDE.md`, `scripts/integrar.sh`, `pnpm verificar:permisos` en CI, `pnpm demo:datos`).
- Bloqueado: credenciales de INFILE y pasarela; `lab.rsc` en el MikroTik físico; `infra/.env`.
- Siguiente: revisar e integrar el día 3.

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
