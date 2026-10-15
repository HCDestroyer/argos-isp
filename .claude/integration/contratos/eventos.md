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
- Un solo relay activo a la vez (lock en Redis, regla 6).

## Consumo

- Cada consumidor usa su propio **grupo** de Redis Streams sobre `argos:eventos` (`XREADGROUP` + `XACK`). Nombres de grupo:

| Grupo | Dueño | Eventos que le interesan |
| --- | --- | --- |
| `coa` | A2 (`services/coa`) | `servicio.estado_cambiado`, `servicio.config_cambiada` |
| `billing` | A3 | `pago.registrado` (cumplir promesas), `servicio.creado` (fecha de instalación / prorrateo) |
| `notify` | A6 | los de `EVENTOS_NOTIFICABLES` en `apps/api/app/notify/consumidor.ts` |
| `aaa-cache` | A1 | `servicio.*`, `asignacion.cambiada` y cambios de plan (reescribe `aaa:user:<user_ppp>`) |

- Dentro de `apps/api` el consumidor implementa la interfaz `ConsumidorEventos` (hoy en `apps/api/app/notify/consumidor.ts`; A1 la mueve a `apps/api/app/shared/eventos_bus.ts` en la tarea 10 y deja el import viejo reexportado):

```ts
interface EventoEntrante { id: number | string; evento: string; payload: Record<string, unknown>; requestId?: string | null }
interface ConsumidorEventos { readonly nombre: string; acepta(evento: string): boolean; procesar(e: EventoEntrante): Promise<void> }
```

- `procesar` es **idempotente por `id`**: el mismo evento puede llegar dos veces. Si lanza, el worker no hace `XACK` y el evento se reintenta (reclamado con `XAUTOCLAIM` tras 60 s).
- Los consumidores no deciden estados ni mueven dinero por su cuenta: llaman acciones de dominio (regla 1).

## Pruebas

- Los consumidores se prueban alimentando `procesar()` directamente con un `EventoEntrante`, sin Redis.
- La prueba de integración del relay (A1) usa un prefijo de stream propio (`<COLAS_PREFIJO>argos:eventos`) para no chocar con otros agentes que prueban en paralelo.
