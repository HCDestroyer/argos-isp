# Módulo `portal` (A5)

Endpoints públicos y del cliente para `apps/portal`. Rutas en `start/routes/portal.ts`.

## Qué hace

| Endpoint | Acción | Qué devuelve |
| --- | --- | --- |
| `GET /api/v1/portal/quien-soy` (público) | `actions/identificar_por_ip.ts` (`portal.quien_soy`) | `QuienSoy`: identificado, ip, nombre parcial ("Juan P."), estado, promesa activa, monto adeudado y facturas vencidas (cantidad y total) |
| `GET /api/v1/portal/estado` (público) | `actions/consultar_estado_por_ip.ts` (`portal.estado`) | `EstadoPortal`: identificado, estado y monto adeudado. Sin nombre ni IP: la página de corte lo consulta cada 5 s tras un pago o una promesa |

Las dos son lecturas puras (`consultas.ts`: resolución de la IP, saldo y nombre parcial): no cambian
estado ni emiten eventos. Se auditan en `audit.acciones` (canal `portal`, entidad `servicio`, entrada
`{ ip }`) porque son públicas y revelan información de un cliente.

### Auditoría una vez por ventana

Cada visita a `/corte` y cada consulta del estado en vivo (cada 5 s) escribían una fila y llenaban la
línea de tiempo del cliente. `ConsultaPortalAuditada` (`actions/consulta_auditada.ts`) responde
siempre, pero audita solo la primera consulta de cada IP + servicio + acción dentro de
`PORTAL_AUDITORIA_VENTANA_S` (600 s; `0` audita todas). La fila la escribe `RegistrarConsultaPortal`
(un `DomainAction`), así que actor, canal y request id son los de siempre.

- La marca vive en Redis (`auditoria_unica.ts`, `SET NX PX`):
  `<prefijo>:portal:auditado:<accion>:<ip>:<servicio|ninguno>`. Es una ventana, no una caché de
  datos: la identificación se calcula siempre contra Postgres.
- Una IP que cambia de servicio se audita en el acto (cambia la clave). Una IP sin servicio también
  se audita una vez por ventana.
- Si Redis no responde, se audita. Si la auditoría falla, se libera la marca y la consulta falla.
- Si la lectura falla, el error se audita (sin ventana) y se relanza.

### Resolución de la IP

1. `network.sesiones` activas (`fin IS NULL`): `ipv4` igual, o IPv6 contenida en `prefijo_enlace_v6`
   o `prefijo_delegado_v6` (`>>=`). Gana la sesión más reciente.
2. Asignaciones vigentes: `network.ipv4_asignaciones.ip` o `network.ipv6_asignaciones.prefijo`.

Se reemplaza por `GET /ip/{ip}` de A1 cuando exista (`NEEDS(A1)` en la acción y en `.claude/integration/a5.md`).

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

Se leen de `process.env` en cada petición; declaradas en `start/env.ts` y `.env.example`.

### Límite de peticiones

`limite_peticiones.ts`, aplicado en la ruta después de resolver la IP y antes de la acción.
Ventana fija en Redis (`INCR` + `PEXPIRE` atómicos en un script Lua) por endpoint e IP: la IPv4 tal
cual y la IPv6 por su /64 (un cliente puede rotar direcciones dentro del prefijo). La expiración es la
del contador de la ventana, no una caché de datos, así que no choca con la regla 5.

- Respuestas con `RateLimit-Limit` y `RateLimit-Remaining`.
- Al pasarse: 429 `application/problem+json` (`urn:argosisp:problema:demasiadas_peticiones`) con
  `Retry-After` en segundos. La acción no corre (no identifica ni audita).
- Si Redis no responde (500 ms), la petición pasa y se registra un aviso: la página de corte no se cae
  por el limitador.

| Variable | Defecto | Qué es |
| --- | --- | --- |
| `PORTAL_LIMITE_PETICIONES` | `30` | Peticiones por ventana y por IP; `0` lo apaga |
| `PORTAL_LIMITE_VENTANA_S` | `60` | Largo de la ventana en segundos |
| `PORTAL_REDIS_PREFIJO` | `COLAS_PREFIJO` o `argosisp` | Prefijo de las claves del portal en Redis (`redis_portal.ts`): `<prefijo>:portal:limite:<endpoint>:<ip>` y `<prefijo>:portal:auditado:…` |
| `PORTAL_AUDITORIA_VENTANA_S` | `600` | Ventana de auditoría de las consultas públicas; `0` audita todas |

## Eventos

No emite ni consume eventos todavía.

## Pruebas

`tests/portal/auditoria_unica.spec.ts`: misma IP y servicio auditan una vez (quien-soy y estado por
separado), otra IP u otro servicio se auditan, IP sin servicio, fin de la ventana, ventana `0`, Redis
caído audita, auditoría fallida libera la marca.

`tests/portal/estado.spec.ts`: solo estado y monto (sin datos personales ni IP), IPv6 delegada, IP
desconocida, refleja la reactivación (`CambiarEstadoServicio`), auditoría y contador de límite propio.
Datos de prueba compartidos en `tests/portal/ayudas_portal.ts`.

`tests/portal/limite_peticiones.spec.ts` (Redis real): 429 con `Retry-After` y sin auditoría, contadores
por IPv4 y por /64, fin de la ventana, `0` lo apaga, Redis caído deja pasar, configuración y claves.

`tests/portal/quien_soy.spec.ts`: IPv4, IPv6 en /56 delegado y /64 de enlace, asignaciones sin sesión,
sesión cerrada, X-Forwarded-For falso, sin proxies confiables, cabecera configurable, auditoría y que
no se filtren datos personales.
