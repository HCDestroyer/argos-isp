# Módulo `portal` (A5)

Endpoints públicos y del cliente para `apps/portal`. Rutas en `start/routes/portal.ts`.

## Qué hace

| Endpoint | Acción | Qué devuelve |
| --- | --- | --- |
| `GET /api/v1/portal/quien-soy` (público) | `actions/identificar_por_ip.ts` (`portal.quien_soy`) | `QuienSoy`: identificado, ip, nombre parcial ("Juan P."), estado, promesa activa, monto adeudado y facturas vencidas (cantidad y total) |

`portal.quien_soy` es de solo lectura: no cambia estado ni emite eventos. Se audita en
`audit.acciones` (canal `portal`, entidad `servicio`, entrada `{ ip }`) porque es público y revela
información de un cliente.

### Resolución de la IP

1. `network.sesiones` activas (`fin IS NULL`): `ipv4` igual, o IPv6 contenida en `prefijo_enlace_v6`
   o `prefijo_delegado_v6` (`>>=`). Gana la sesión más reciente.
2. Asignaciones vigentes: `network.ipv4_asignaciones.ip` o `network.ipv6_asignaciones.prefijo`.

Se reemplaza por `GET /ip/{ip}` de A1 cuando exista (`NEEDS(A1)` en la acción y en `.claude/INTEGRATION.md`).

### Montos

`monto_adeudado` = suma de `total - pagado` de las facturas del servicio en `emitida`, `parcial` o
`vencida` (con `decimal.js`, sin `number`). Vencidas: estado `vencida` o `vence_en` anterior a hoy en
`America/Guatemala`. Nunca se devuelven nombre completo, contacto, NIT, dirección ni usuario PPPoE.

### IP de origen y proxies

`ip_origen.ts` toma la IP del socket. Solo si la conexión viene de un proxy listado en
`PORTAL_PROXIES_CONFIABLES` usa la cabecera `PORTAL_CABECERA_IP` y la recorre desde la derecha
saltando proxies confiables. El portal (Nitro) agrega la IP de su socket al final de `X-Forwarded-For`.

| Variable | Ejemplo | Qué es |
| --- | --- | --- |
| `PORTAL_PROXIES_CONFIABLES` | `172.16.0.0/12,fd00::/8` | IPs/CIDR del contenedor del portal y de cualquier proxy inverso delante. Vacía = la cabecera se ignora |
| `PORTAL_CABECERA_IP` | `x-forwarded-for` (defecto) | Cabecera con la IP del cliente |

Se leen de `process.env` en cada petición; pendientes de agregar a `start/env.ts` y `.env.example` (líder BE).

## Eventos

No emite ni consume eventos todavía.

## Pruebas

`tests/portal/quien_soy.spec.ts`: IPv4, IPv6 en /56 delegado y /64 de enlace, asignaciones sin sesión,
sesión cerrada, X-Forwarded-For falso, sin proxies confiables, cabecera configurable, auditoría y que
no se filtren datos personales.
