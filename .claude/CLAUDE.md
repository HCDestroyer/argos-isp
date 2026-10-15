# CLAUDE.md — ArgosIsp

Este archivo lo leen todos los agentes. Es la ley del repositorio. Si una tarea te obliga a romper una regla de aquí, detente y pregunta al líder; no la rompas.

## Qué estamos construyendo

ArgosIsp es el sistema de gestión para un ISP en Guatemala, alternativa a Mikrowisp: clientes, servicios PPPoE (IPv4 + IPv6) controlados por RADIUS, facturación con libro contable de doble partida, cobros, promesas de pago, corte y reactivación automáticos, notificaciones, ACL, auditoría. Integraciones posteriores: FEL (INFILE), SmartOLT, Horus (tráfico), MCP para agentes de IA.

Plan completo en `PLAN.md`. Tu frente específico está en `agents/<tu-archivo>.md`. Lee los tres antes de escribir código.

## Stack (fijo, no se discute)

| Capa | Tecnología |
| --- | --- |
| Backend | AdonisJS 6 (TypeScript), Lucid ORM, VineJS |
| Base de datos | PostgreSQL 16, un schema por módulo: `core`, `network`, `billing`, `ledger`, `notify`, `audit` |
| Caché, colas, eventos | Redis 7, BullMQ |
| RADIUS | FreeRADIUS 3.2 con `rlm_rest` → servicio `aaa` (Node) |
| CoA / Disconnect | servicio `coa` (Node, paquete `radius`) |
| Router | MikroTik RouterOS 7, API REST para lo que no pasa por RADIUS |
| Frontend | Nuxt 4 + @nuxt/ui v4 + Tailwind CSS, tipos generados desde OpenAPI |
| Infra | Docker Compose (dev y lab), GitHub Actions |
| Node | 22 LTS, pnpm workspaces |

## Estructura del monorepo

```
apps/api         AdonisJS (paquete @argosisp/api): módulos de dominio, API REST, workers y crons (BullMQ)
apps/web         Nuxt: panel de administración (@argosisp/web)
apps/portal      Nuxt: portal del cliente y página de corte (@argosisp/portal)
services/aaa     Endpoints /aaa/authorize y /aaa/accounting para FreeRADIUS + config de FreeRADIUS
services/coa     coa-dispatcher: consume eventos y envía CoA/Disconnect al NAS
packages/contracts  OpenAPI generado desde apps/api y tipos TS para los frontends
infra/           docker-compose, scripts de MikroTik (.rsc), CI, seeds de laboratorio
agents/          brief de cada agente
```

Cada agente es dueño de las carpetas que indica su brief. No toques carpetas de otro agente; si necesitas algo de otro módulo, pídelo por su interfaz pública (acción, evento o endpoint) y deja un comentario `// NEEDS(<agente>): ...` en un archivo `INTEGRATION.md` en la raíz.

## Reglas de arquitectura

### 1. Toda la lógica vive en acciones de dominio

- `apps/api/app/<modulo>/actions/<verbo_sustantivo>.ts`. Una acción = una clase con `execute(input, ctx)`.
- Controladores, crons, webhooks, workers y el MCP solo validan entrada y llaman acciones. Cero lógica de negocio fuera de `actions/`.
- Toda acción recibe `ctx` con `actor` (usuario, token, agente, sistema), `canal` y `requestId`.
- Toda acción escribe su registro de auditoría dentro de la misma transacción. La clase base `DomainAction` ya lo hace; extiéndela.

### 2. Acciones explícitas, no PATCH de estados

`POST /servicios/:id/suspender`, `POST /facturas/:id/anular`, `POST /promesas`. Nunca `PATCH { estado: 'suspendido' }`. Cada acción tiene su permiso en el ACL con el mismo nombre (`servicios.suspender`).

### 3. Eventos con outbox

- Cambios de estado y hechos de negocio emiten eventos del catálogo (abajo). El evento se escribe en `audit.outbox` en la **misma transacción** que el cambio. Un relay lo publica a Redis.
- Consumidores idempotentes: un evento puede llegar dos veces.
- Las reactivaciones viajan por evento, nunca esperan al cron.

### 4. Libro contable inmutable

- Todo lo que mueve dinero genera un asiento de doble partida en `ledger`. Debe = Haber siempre; hay una restricción en base de datos que lo verifica.
- Nunca `UPDATE` ni `DELETE` sobre `ledger.*` ni `audit.*`. Errores se corrigen con asiento de reverso o nota de crédito.
- El saldo de un cliente es la suma de su auxiliar; no existe una columna `saldo`.
- Montos en `numeric(14,2)`; en TypeScript usar `decimal.js`. Prohibido `number` para dinero.

### 5. Invalidación explícita, nunca TTL

Cualquier caché (autorización RADIUS en Redis, mapa `ip → servicio_id`, catálogos) se invalida por evento cuando cambia el dato. No se configuran TTL como mecanismo de consistencia.

### 6. Idempotencia y concurrencia

- Toda operación que mueve dinero o estado acepta `Idempotency-Key` (header). Se guarda en `core.idempotency_keys` con la respuesta.
- Los crons procesan "todo lo pendiente hasta ahora", nunca "lo de hoy", con claves únicas (ej. factura = `servicio_id + periodo`).
- Ediciones de entidades llevan `version`; conflicto → 409.
- Cada job repetible de BullMQ corre con lock (solo una instancia).

### 7. API

- Rutas REST bajo `/api/v1`, recursos en español en plural: `/clientes`, `/servicios`, `/facturas`, `/pagos`, `/promesas`.
- Errores en formato RFC 9457 (`application/problem+json`) con `type`, `title`, `status`, `detail`, `errors[]`.
- Listas con paginación por cursor: `?cursor=&limit=`; respuesta `{ data, nextCursor }`.
- Token en `Authorization: Bearer`, nunca en el body.
- Todo endpoint tiene validador VineJS; el OpenAPI se genera de ahí (`pnpm contracts:build`). Si cambias un validador, regenera y commitea `packages/contracts`.

### 8. ACL

- Permiso = nombre de la acción (`facturas.crear`). Roles agrupan permisos. Alcance opcional por router, zona o caja.
- Roles base en seed: `admin`, `cajero`, `soporte`, `tecnico`, `contabilidad`, `lectura`.
- Un token de API o un agente de IA es un usuario con alcances acotados; pasa por el mismo ACL.

### 9. Auditoría

- `audit.acciones`: actor, canal, acción, entidad, entrada, resultado, request_id. Automática por `DomainAction`.
- `audit.cambios`: diff por campo en clientes, servicios, planes, plantillas, reglas. Datos sensibles (contraseñas PPPoE, credenciales, tokens) se registran como `***`.
- Actualizaciones masivas nunca usan `Model.query().update()`; pasan por una acción que registra cada fila.
- `audit.red`: cada CoA, Disconnect o comando a RouterOS con la respuesta del equipo.

### 10. Frontend

- Solo componentes de Nuxt UI (`UButton`, `UTable`, `UForm`, `UModal`…). Nunca `<button>`, `<input>` o `<table>` crudos.
- Indentación de 4 espacios en `<script>`, `<template>` y objetos `:ui`.
- Tipos y cliente HTTP desde `packages/contracts`; nada de interfaces duplicadas a mano.
- Composables en `composables/`, un recurso por composable (`useClientes`, `useFacturas`).
- Formularios con `UForm` + esquema `valibot` o `zod` espejo del validador del backend.
- Modo claro y oscuro funcionando; revisar en 390px y 1280px.

### 11. Pruebas y Definition of Done

Una tarea está terminada solo si:

- [ ] La acción tiene pruebas de integración (Japa) contra Postgres real en Docker, y pasan en CI
- [ ] El endpoint está en el OpenAPI y `packages/contracts` se regeneró
- [ ] La acción registra auditoría y, si cambia estado, emite su evento por outbox
- [ ] `pnpm lint` y `pnpm typecheck` pasan en todo el workspace
- [ ] Hay un `README.md` corto en el módulo: qué hace, qué eventos emite y consume
- [ ] Actualizaste `INTEGRATION.md` si dependes de otro agente

Prohibido marcar como terminado algo que "funciona en mi máquina" sin pruebas.

## Catálogo de eventos (nombre, payload mínimo)

| Evento | Emite | Payload |
| --- | --- | --- |
| `servicio.creado` | núcleo | servicio_id, cliente_id, router_id, plan_id |
| `servicio.estado_cambiado` | núcleo | servicio_id, de, a, motivo |
| `servicio.config_cambiada` | núcleo | servicio_id, campos (plan, ips, prefijo_v6, router) |
| `asignacion.cambiada` | núcleo/IPAM | servicio_id, ipv4[], prefijo_enlace_v6, prefijo_delegado_v6, inicio, fin |
| `sesion.iniciada` / `sesion.terminada` | aaa | servicio_id, nas_ip, acct_session_id, ipv4, prefijos_v6 |
| `factura.emitida` / `factura.vencida` / `factura.anulada` | billing | factura_id, servicio_id, cliente_id, total, vence |
| `pago.registrado` / `pago.anulado` | billing | pago_id, cliente_id, monto, metodo, facturas[] |
| `promesa.creada` / `promesa.cumplida` / `promesa.incumplida` | billing | promesa_id, servicio_id, vence, monto |
| `caja.cerrada` | ledger | caja_id, cajero_id, esperado, contado, diferencia |
| `notificacion.enviada` | notify | cliente_id, canal, evento_origen, estado |

## Estados del servicio

`activo` → `limitado` → `suspendido` → `retirado`, más `promesa_activa` como bandera, no como estado. La función `evaluarEstadoServicio(servicio_id)` en `billing/actions` es la **única** que decide el estado a partir de facturas vencidas, reglas de la plantilla y promesas. La llaman el cron de corte, `registrarPago`, `crearPromesaPago` e `incumplirPromesa`.

## Convenciones generales

- Código, nombres de tablas, rutas y mensajes en español; identificadores de código en `camelCase`/`PascalCase`, tablas y columnas en `snake_case`.
- Commits: `feat(billing): generar facturas por periodo` (Conventional Commits, alcance = módulo).
- Una PR por tarea del brief, con el número de tarea en el título. PR pequeñas.
- Variables de entorno documentadas en `.env.example` de cada app; nunca secretos en el repo.
- Fecha y hora en UTC en base de datos; zona `America/Guatemala` solo al mostrar.
- No instales dependencias nuevas sin anotarlas en la PR con el motivo.
