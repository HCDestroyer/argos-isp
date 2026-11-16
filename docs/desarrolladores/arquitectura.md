---
orden: 1
---

# Arquitectura

ArgosIsp es un monorepo con una API central (AdonisJS 6 sobre PostgreSQL 16 y Redis 7), dos frontends Nuxt y dos servicios Node que hablan RADIUS. Toda la lógica de negocio vive en la API; los demás procesos leen o escriben a través de ella o del bus de eventos.

## Piezas

| Pieza                   | Dónde                     | Qué hace                                                                                                                                                                                             |
| ----------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `api`                   | `apps/api`                | API REST bajo `/api/v1`: acciones de dominio, ACL, auditoría, outbox. Genera el OpenAPI (`packages/contracts`).                                                                                      |
| `api-portal` (opcional) | misma imagen que `api`    | Segundo proceso HTTP con la misma base y el mismo Redis, para que el tráfico del portal del cliente y la página de corte no compita con el panel. Sin migraciones, workers ni relay.                 |
| `web`                   | `apps/web`                | Panel de administración (Nuxt 4 + Nuxt UI). Entra con la sesión en cookie (`argos_sesion`).                                                                                                          |
| `portal`                | `apps/portal`             | Portal del cliente y página de corte. Usa su propia sesión (`argos_portal`).                                                                                                                         |
| `aaa`                   | `services/aaa`            | Endpoints que FreeRADIUS llama con `rlm_rest`: `/aaa/authorize`, `/aaa/post-auth` y `/aaa/accounting`. Lee la autorización de Redis (`aaa:user:<user_ppp>`) y, si no está, la pide a la API interna. |
| `coa`                   | `services/coa`            | Consume el bus y manda CoA-Request o Disconnect-Request (RFC 5176) a las sesiones abiertas cuando cambia el estado o la configuración de un servicio. Registra cada envío en `audit.red`.            |
| `freeradius`            | `services/aaa/freeradius` | FreeRADIUS 3.2; autentica PAP/CHAP con lo que devuelve `aaa`.                                                                                                                                        |
| Workers                 | `apps/api/commands`       | Procesos `node ace …` de la misma imagen de la API (tabla siguiente).                                                                                                                                |
| PostgreSQL 16           |                           | Un schema por módulo (abajo).                                                                                                                                                                        |
| Redis 7                 |                           | Stream de eventos `argos:eventos`, colas BullMQ, caché de autorización RADIUS y locks. Sin expulsión de claves (`maxmemory-policy noeviction`).                                                      |

### Workers

Cada uno es un servicio del `docker-compose` de producción (`infra/produccion/docker-compose.produccion.yml`).

| Comando                    | Servicio          | Qué hace                                                                                                                              |
| -------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `node ace eventos:relay`   | `relay`           | Publica `audit.outbox` en el stream `argos:eventos`, mantiene la caché `aaa:user:*` (grupo `aaa-cache`) y corre los crons del núcleo. |
| `node ace billing:worker`  | `billing-worker`  | Genera facturas, vence con mora, ejecuta el corte, cierra promesas y consume el grupo `billing`.                                      |
| `node ace fiscal:worker`   | `fiscal-worker`   | Certifica, reintenta y anula DTE (FEL); calendario fiscal y alertas de vencimiento.                                                   |
| `node ace sesiones:worker` | `sesiones-worker` | Accounting RADIUS: escribe las sesiones y emite `sesion.iniciada` / `sesion.terminada`.                                               |
| `node ace aaa:vigilar`     | `aaa-vigia`       | Revisa la salud de los nodos `aaa`; emite `aaa.caido` y `aaa.recuperado`.                                                             |
| `node ace routeros:worker` | `routeros-worker` | Aplica en RouterOS (API REST) lo que no pasa por RADIUS y reconcilia los routers.                                                     |
| `node ace notify:worker`   | `worker`          | Entrega notificaciones (correo, Telegram), recordatorios.                                                                             |
| `node ace horus:worker`    | `horus-worker`    | Webhooks firmados hacia Horus, con reintentos.                                                                                        |
| `node ace iris:worker`     | `iris-worker`     | Webhooks firmados hacia Iris, con reintentos.                                                                                         |

### Schemas de PostgreSQL

`core` (clientes, servicios, usuarios, roles, tokens, empresas), `network` (routers, redes IPv4, IPAM IPv6, planes, sesiones), `billing` (facturas, pagos, promesas), `ledger` (libro de doble partida), `fiscal`, `inventario`, `lealtad`, `notify`, `integraciones` (conectores Horus e Iris y sus envíos), `importacion` y `audit` (acciones, cambios, red y outbox).

`ledger.*` y `audit.*` son de solo inserción: los errores se corrigen con un asiento de reverso o una nota de crédito, nunca con `UPDATE` ni `DELETE`.

## Cómo viaja un cambio

Ejemplo: un operador suspende un servicio con `POST /api/v1/servicios/42/suspender`.

1. **Entrada.** El middleware de la ruta corre en este orden: `X-Request-Id` (o un UUID nuevo, que vuelve en la respuesta) → autenticación → empresa activa (`X-Empresa-Id`) → `autorizar('servicios.suspender')` → idempotencia (`Idempotency-Key`, si la ruta la acepta) → validación VineJS del cuerpo → handler.
2. **Acción de dominio.** El handler solo llama `SuspenderServicio.execute(entrada, ctx)`. El `ctx` lleva el actor (`usuario`, `token` o `sistema`), el canal (`panel`, `api`, `ia`, `portal`, `cron`, `worker`, `webhook`, `interno`, `consola`), el `requestId` y la empresa activa. Toda acción extiende `DomainAction` (`apps/api/app/shared/domain_action.ts`) y corre en una transacción.
3. **Auditoría en la misma transacción.** `audit.acciones` recibe actor, canal, acción (el mismo nombre del permiso), entidad, entrada, resultado y `request_id`. `audit.cambios` guarda el diff por campo; los datos sensibles (contraseñas PPPoE, tokens, credenciales) quedan como `***`. Si la acción falla, se revierte y el error se audita aparte.
4. **Outbox en la misma transacción.** `t.emit('servicio.estado_cambiado', { … })` escribe la fila en `audit.outbox`. Si la transacción se revierte, el evento no existe.
5. **Relay.** `eventos:relay` lee el outbox en orden de `id`, hace `XADD` al stream `argos:eventos` y marca `publicado_en`. Un solo relay activo a la vez (lock en Redis).
6. **Consumidores.** Cada módulo lee con su propio grupo de Redis Streams y confirma con `XACK`: `coa` manda el CoA o el Disconnect al router, `aaa-cache` reescribe `aaa:user:<user_ppp>`, `notify` avisa al cliente, `horus` e `iris` arman los webhooks hacia esos sistemas. El detalle está en [Eventos](./eventos.md).

```text
HTTP ─► middleware ─► DomainAction ──┬─► tablas del módulo
                                     ├─► audit.acciones / audit.cambios
                                     └─► audit.outbox ──► relay ──► argos:eventos ──► grupos (coa, aaa-cache, notify, billing, horus, iris…)
                                         (una transacción)
```

Las cachés no tienen TTL como mecanismo de consistencia: se invalidan por evento. Por eso una reactivación llega al router en segundos, sin esperar a un cron.

## Multiempresa

Una instalación puede facturar con varias empresas (varios NIT). Contrato completo: [`multiempresa.md`](../../.claude/integration/contratos/multiempresa.md).

- Todo lo de un servicio y todo lo financiero lleva `empresa_id`. Un pago, un asiento o una caja nunca mezclan empresas; un cobro en caja que cubre facturas de varias empresas se divide en un pago por empresa (`cobro_id`).
- **Empresa activa.** Cada petición con sesión puede mandar `X-Empresa-Id: <id>`. El usuario debe tener acceso a esa empresa (si no, `403 empresa_no_permitida`; un valor que no es un id, `400`). Sin cabecera, la empresa activa es la única del usuario; si tiene varias, no hay empresa activa.
- **Listas.** Se filtran por la empresa activa. Sin empresa activa, muestran la unión de las empresas del usuario. `?empresas=todas` es el consolidado y solo funciona con alcance global o con acceso a todas las empresas activas (si no, `403 empresa_no_permitida`).
- **Altas.** Lo que necesita una empresa y no la puede deducir responde `422 empresa_requerida`. Por ejemplo, `POST /servicios` toma `empresa_id` del cuerpo, o la sugerida de la zona del cliente, la del router o la empresa activa.
- Un token de API usa el alcance de empresas de su usuario. `GET /me` devuelve `alcance_global`, `empresas[]` y `empresa_activa_id`.
- Con una sola empresa el sistema se comporta igual que sin multiempresa.

## Relacionado

- [Autenticación](./autenticacion.md) y [Permisos](./permisos.md)
- [Convenciones de la API](./convenciones-api.md)
- [Referencia de la API](./referencia/)
