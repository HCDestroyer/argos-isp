---
orden: 5
---

# Eventos

Cada hecho de negocio (un servicio creado, un pago registrado, un cambio de estado) emite un evento del catálogo. El evento se escribe en `audit.outbox` **en la misma transacción** que el cambio: si el cambio se revierte, el evento no existe, y si el cambio se confirmó, el evento se publica tarde o temprano.

El catálogo completo, con el payload exacto de cada evento, está en [Catálogo de eventos](./referencia/eventos.md), generado del código (`apps/api/app/shared/eventos.ts`). El contrato del bus es [`eventos.md`](../../.claude/integration/contratos/eventos.md).

## Cómo viajan

1. Una acción llama `t.emit(evento, payload)`; solo acepta nombres del catálogo.
2. El relay (`node ace eventos:relay`) lee las filas de `audit.outbox` sin publicar, en orden de `id`, y hace `XADD` al stream de Redis `argos:eventos`. Después marca `publicado_en`. Las filas del outbox nunca se borran.
3. Cada consumidor lee el stream con su propio grupo (`XREADGROUP`) y confirma con `XACK` cuando terminó bien.

Cada entrada del stream tiene estos campos (todos texto):

| Campo        | Valor                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------- |
| `id`         | id de la fila en `audit.outbox`. Identificador estable del evento: úsalo para deduplicar. |
| `evento`     | Nombre del catálogo, por ejemplo `servicio.estado_cambiado`.                              |
| `payload`    | JSON del payload.                                                                         |
| `request_id` | `X-Request-Id` de la petición que lo originó (puede ir vacío).                            |

## Garantías

- **Al menos una vez.** Si el relay cae entre el `XADD` y la marca de publicado, el lote se publica de nuevo. Si un consumidor falla, no confirma y el evento se le entrega otra vez (lo pendiente hace más de 60 s se reclama con `XAUTOCLAIM`).
- **Consumidores idempotentes.** Por lo anterior, todo consumidor debe tolerar el mismo evento dos veces, deduplicando por `id`.
- **Orden.** Dentro de un lote, el orden es el de `id`. Una transacción que confirma tarde puede publicar un `id` menor después de uno mayor: no supongas orden estricto entre eventos de entidades distintas.
- **Un solo relay activo** (lock en Redis). El stream se recorta a unas 100 000 entradas; los grupos leen mucho antes.
- **Campos aditivos.** Los payloads crecen con campos nuevos (por ejemplo, `empresa_id` desde la multiempresa). Ignora los campos que no conozcas.
- Los consumidores no deciden estados ni mueven dinero por su cuenta: llaman acciones de dominio, que vuelven a auditar y a emitir.

## Quién consume qué

| Grupo       | Proceso           | Para qué                                                                                            |
| ----------- | ----------------- | --------------------------------------------------------------------------------------------------- |
| `coa`       | `services/coa`    | CoA o Disconnect a las sesiones abiertas cuando cambia el estado o la configuración de un servicio. |
| `routeros`  | `routeros:worker` | Estado deseado del servicio en RouterOS (colas, address-list, leases) y control de velocidad.       |
| `aaa-cache` | `eventos:relay`   | Reescribe `aaa:user:<user_ppp>`, la autorización RADIUS en Redis.                                   |
| `billing`   | `billing:worker`  | Cumplir promesas con los pagos, refrescar el tablero.                                               |
| `lealtad`   | `billing:worker`  | Puntos por pagos y facturas, referidos.                                                             |
| `notify`    | `notify:worker`   | Avisos al cliente.                                                                                  |
| `horus`     | `horus:worker`    | Webhooks hacia Horus.                                                                               |
| `iris`      | `iris:worker`     | Webhooks hacia Iris.                                                                                |

Un sistema externo **no lee Redis**: recibe los eventos que le interesan como [webhooks firmados](./webhooks.md).

## Eventos principales

| Evento                                                       | Payload mínimo                                                                                     |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `servicio.creado`                                            | `servicio_id`, `empresa_id`, `cliente_id`, `router_id`, `plan_id`                                  |
| `servicio.estado_cambiado`                                   | `servicio_id`, `empresa_id`, `de`, `a`, `motivo`                                                   |
| `servicio.config_cambiada`                                   | `servicio_id`, `empresa_id`, `campos[]` (`plan`, `ips`, `prefijo_v6`, `router`, …)                 |
| `asignacion.cambiada`                                        | `servicio_id`, `empresa_id`, `ipv4[]`, `prefijo_enlace_v6`, `prefijo_delegado_v6`, `inicio`, `fin` |
| `cliente.actualizado`                                        | `cliente_id`, `empresa_id`, `empresas[]`, `campos[]` (solo nombres, nunca valores)                 |
| `sesion.iniciada` / `sesion.terminada`                       | `servicio_id`, `nas_ip`, `acct_session_id`, `ipv4`, prefijos v6, `origen`                          |
| `factura.emitida` / `factura.vencida` / `factura.anulada`    | `factura_id`, `empresa_id`, `servicio_id`, `cliente_id`, `total`, `vence`                          |
| `pago.registrado` / `pago.anulado`                           | `pago_id`, `empresa_id`, `cobro_id`, `cliente_id`, `monto`, `metodo`, `facturas[]`                 |
| `promesa.creada` / `promesa.cumplida` / `promesa.incumplida` | `promesa_id`, `empresa_id`, `cliente_id`, `servicio_id`, `vence`, `monto`                          |
| `caja.cerrada`                                               | `caja_id`, `empresa_id`, `cajero_id`, `esperado`, `contado`, `diferencia`                          |
| `notificacion.enviada`                                       | `cliente_id`, `canal`, `evento_origen`, `estado`                                                   |

Convenciones de los payloads: ids numéricos, dinero como string decimal (`"150.00"`), instantes en ISO 8601 UTC y fechas como `YYYY-MM-DD`. Los datos sensibles (contraseñas PPPoE, credenciales, tokens) nunca viajan en un evento.

Estados del servicio en `de` y `a`: `pendiente_instalacion`, `activo`, `limitado`, `suspendido`, `retirado`. `promesa_activa` es una bandera del servicio, no un estado.

## Consumir dentro de `apps/api`

Un consumidor implementa `ConsumidorEventos` de `apps/api/app/shared/eventos_bus.ts` y corre con `EjecutorGrupo`:

```ts
interface EventoEntrante {
    id: number | string
    evento: string
    payload: Record<string, unknown>
    requestId?: string | null
}
interface ConsumidorEventos {
    readonly nombre: string
    acepta(evento: string): boolean
    /** Idempotente por `id`. Si lanza, el evento no se confirma y se reintenta. */
    procesar(evento: EventoEntrante): Promise<void>
}
```

`new EjecutorGrupo({ grupo, consumidores })` crea el grupo si no existe (lee el stream desde el principio), lee, confirma cuando todos los consumidores que aceptan el evento terminaron bien y reclama lo pendiente.
