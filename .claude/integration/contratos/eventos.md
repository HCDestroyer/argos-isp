# Contrato del bus de eventos

Define cómo viajan los eventos del catálogo (`.claude/CLAUDE.md`, sección "Catálogo de eventos") desde `audit.outbox` hasta sus consumidores. Lo implementa A1 (tarea 10, relay) y lo consumen A2 (`coa`), A3 (billing), A6 (notify) y A1 (invalidación de caché `aaa:user:*`). Cambios a este contrato: se acuerdan en el archivo de integración de quien lo pide y se actualiza este archivo en la misma PR.

## Publicación (A1)

- El relay lee `audit.outbox` con `publicado_en IS NULL`, en orden de `id`, por lotes, y hace `XADD` al stream de Redis **`argos:eventos`**.
- Campos de cada entrada del stream (todos texto):

| Campo | Valor |
| --- | --- |
| `id` | `audit.outbox.id` (identificador estable del evento; sirve para deduplicar) |
| `evento` | nombre del catálogo, p. ej. `servicio.estado_cambiado` |
| `payload` | JSON del payload tal como se escribió en el outbox |
| `request_id` | `audit.outbox.request_id` de la acción que lo emitió (puede ir vacío) |

- Después del `XADD` marca `publicado_en`. Si el proceso cae entre ambos pasos, el evento se publica dos veces: **entrega al menos una vez**.
- El stream se recorta con `XADD … MAXLEN ~ 100000`. No es un mecanismo de consistencia (regla 5): los grupos leen mucho antes de que una entrada se recorte.
- Un solo relay activo a la vez (lock en Redis `<COLAS_PREFIJO>:lock:eventos-relay` con dueño y renovación, regla 6).
- Implementación (A1, tarea 10): `apps/api/app/shared/relay_outbox.ts`, comando `node ace eventos:relay` (que además consume el grupo `aaa-cache`; `--sin-aaa-cache` lo apaga). El orden es el de `id` dentro de cada lote; una transacción que confirma tarde puede publicar un `id` menor después de uno mayor.

## Eventos fuera de la tabla de `CLAUDE.md`

El catálogo ejecutable es `apps/api/app/shared/eventos.ts` (`CatalogoEventos` + `EVENTOS`). Eventos agregados después de la tabla de `CLAUDE.md` (pendiente de que el líder los pase a esa tabla):

| Evento | Emite | Payload | Lo consume |
| --- | --- | --- | --- |
| `sesion.desconexion_solicitada` | A2 (`DesconectarSesion`, `DesconectarServicio`) | `sesion_id`, `servicio_id` (null si el `user_ppp` no existe), `nas_ip`, `acct_session_id`, `user_ppp`, `motivo` | `coa`: Disconnect-Request a esa sesión si sigue abierta; envío y respuesta en `audit.red` (`comando.evento` = este nombre, `comando.razon` = `manual: <motivo>`), `coa.fallido` si no hay ACK |

| `aaa.caido` | A2 (`node ace aaa:vigilar`, `RegistrarCaidaAaa`) | `nodo`, `desde` (ISO, primer health check fallido), `ultimo_error` (p. ej. `ECONNREFUSED`, `HTTP 503`, `sin respuesta en 2000 ms`) | A6 (`notify`): alerta por Telegram al equipo |
| `aaa.recuperado` | A2 (`RegistrarRecuperacionAaa`) | `nodo`, `desde` (el de la caída), `hasta` (ISO, primer health check bueno), `ultimo_error` | A6 (`notify`): aviso de recuperación |

| `comprobante.recibido` | A3 (`RegistrarComprobante`) | `comprobante_id`, `cliente_id`, `pago_id: null`, `motivo: null` | A6 (`notify`): "Recibimos tu comprobante de pago" |
| `comprobante.aprobado` | A3 (`AprobarComprobante`) | `comprobante_id`, `cliente_id`, `pago_id` (el pago creado), `motivo: null` | A6 (`notify`): "Comprobante de pago aprobado" (el único aviso de pago del pagador) |
| `comprobante.rechazado` | A3 (`RechazarComprobante`) | `comprobante_id`, `cliente_id`, `pago_id: null`, `motivo` (texto del revisor) | A6 (`notify`): "Comprobante de pago rechazado" con `{{comprobante.motivo}}` |

`aaa.caido` se emite cuando un nodo lleva `AAA_CAIDO_TRAS_MS` (60 s) sin responder `GET /health` con 2xx; una sola vez por caída (las acciones miran el último evento del nodo en `audit.outbox`), y `aaa.recuperado` solo después de un `aaa.caido`. El payload de la tabla de `CLAUDE.md` (`nodo`, `desde`) sigue valiendo: `ultimo_error` es un campo más.

`coa.fallido` admite `servicio_id: null` solo en una desconexión manual de una sesión sin servicio conocido.

## Consumo

- Cada consumidor usa su propio **grupo** de Redis Streams sobre `argos:eventos` (`XREADGROUP` + `XACK`). Nombres de grupo:

| Grupo | Dueño | Eventos que le interesan |
| --- | --- | --- |
| `coa` | A2 (`services/coa`) | `servicio.estado_cambiado`, `servicio.config_cambiada`, `sesion.desconexion_solicitada` |
| `billing` | A3 | `pago.registrado` (cumplir promesas), `servicio.creado` (fecha de instalación / prorrateo) |
| `notify` | A6 | los de `EVENTOS_NOTIFICABLES` en `apps/api/app/notify/consumidor.ts` |
| `aaa-cache` | A1 | `servicio.*`, `asignacion.cambiada` y cambios de plan (reescribe `aaa:user:<user_ppp>`) |

- Dentro de `apps/api` el consumidor implementa la interfaz `ConsumidorEventos` (en `apps/api/app/shared/eventos_bus.ts`; `apps/api/app/notify/consumidor.ts` la reexporta):

```ts
interface EventoEntrante { id: number | string; evento: string; payload: Record<string, unknown>; requestId?: string | null }
interface ConsumidorEventos { readonly nombre: string; acepta(evento: string): boolean; procesar(e: EventoEntrante): Promise<void> }
```

- Ejecutor genérico para `apps/api`: `new EjecutorGrupo({ grupo, consumidores })` de `#shared/eventos_bus` (`iniciar()`, `detener()`, `procesarLote()`). Crea el grupo con `XGROUP CREATE ... 0 MKSTREAM` (un grupo nuevo lee el stream desde el principio), lee con `XREADGROUP`, confirma con `XACK` cuando todos los consumidores que `acepta`n terminaron bien y reclama con `XAUTOCLAIM` lo pendiente hace más de 60 s. Lo usan `node ace eventos:relay` (`aaa-cache`) y `node ace notify:worker` (`notify`); A3 lo usa igual para `billing`.
- `procesar` es **idempotente por `id`**: el mismo evento puede llegar dos veces. Si lanza, el worker no hace `XACK` y el evento se reintenta (reclamado con `XAUTOCLAIM` tras 60 s).
- Los consumidores no deciden estados ni mueven dinero por su cuenta: llaman acciones de dominio (regla 1).

## Payloads del núcleo (A1)

`servicio.config_cambiada`: `{ servicio_id, campos[] }`. Valores de `campos`:

| Campo | Cuándo |
| --- | --- |
| `plan`, `router`, `ips`, `prefijo_v6` | Cambió el plan, el router, la IPv4 o los prefijos/modo IPv6 (desde el día 2) |
| `tipo_conexion` | Semana 2 (WISP, `contratos/routeros.md`): el servicio pasó entre `pppoe`, `ip_estatica` y `dhcp_fija`. El dispatcher limpia en el router lo del tipo anterior. Al dejar `pppoe`, `aaa:user:<user_ppp viejo>` queda con lápida |
| `mac`, `amarre_ip_mac` | Semana 2: cambió la MAC (lease de `dhcp_fija`, ARP) o el amarre IP-MAC |

Los consumidores no deben fallar con un campo que no conocen: el dispatcher recalcula el estado deseado completo del servicio con cualquier `servicio.config_cambiada`.

## Payloads de pagos (A3)

`pago.registrado` y `pago.anulado`: `{ pago_id, cliente_id, monto, metodo, facturas[], clientes[] }`.

- `cliente_id` es **quien paga**. `clientes` (desde 2026-10-16, decisión del PM) es el pagador seguido de los dueños de las facturas a las que se aplicó (pago de terceros: una persona paga con una sola transferencia su factura y la de un familiar). Eventos anteriores no lo traen: los consumidores usan `clientes ?? [cliente_id]`.
- `metodo`: `caja`, `pasarela`, `deposito`, `transferencia`, `ach`, `remesa`, `agente`, `debito`.
- Consumidores: `billing` revisa las promesas de cada cliente de `clientes`; `notify` avisa al pagador (`pago.registrado`) y a cada dueño de factura distinto del pagador (`pago.registrado.tercero`: "Recibimos el pago de tu factura N, hecho por <pagador>"), idempotente por (evento, cliente).

## Payloads de comprobantes (A3)

`comprobante.recibido`, `comprobante.aprobado` y `comprobante.rechazado`: `{ comprobante_id, cliente_id, pago_id, motivo }`, siempre con las cuatro claves (`null` cuando no aplica).

- `cliente_id` es el dueño del comprobante (quien depositó); notify no necesita resolverlo por `billing.pagos` (un comprobante pendiente o rechazado no tiene pago).
- Al aprobar, el pago emite además su propio `pago.registrado` en la misma transacción. Decisión de A6 (día 4): el pagador recibe un solo aviso, el de `comprobante.aprobado`; notify omite `pago.registrado` para el pagador cuando `billing.comprobantes.pago_id` es ese pago (y la plantilla de `comprobante.aprobado` está activa), y deduplica por `pago_id`. Los dueños de facturas distintos del pagador reciben igual su aviso de `pago.registrado` (`pago.registrado.tercero`). Detalle en `apps/api/app/notify/README.md`, "Avisos de pago".

## Pruebas

- Los consumidores se prueban alimentando `procesar()` directamente con un `EventoEntrante`, sin Redis.
- La prueba de integración del relay (A1) usa un prefijo de stream propio (`<COLAS_PREFIJO>:argos:eventos`; con `NODE_ENV=test` es el valor por defecto; en otros entornos `EVENTOS_STREAM`) para no chocar con otros agentes que prueban en paralelo.
