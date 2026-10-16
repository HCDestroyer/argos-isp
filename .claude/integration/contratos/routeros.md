# Contrato: servicios sin PPPoE controlados por la API REST de RouterOS

Decisión del PM (día 4): un ISP inalámbrico (WISP) también entrega servicios **sin PPPoE**. Estos servicios no pasan por RADIUS; ArgosIsp los controla escribiendo en el MikroTik por su API REST. El resultado para el cliente debe ser idéntico al de PPPoE: limitar, cortar (aterriza en `/corte`) y reactivar por evento, sin esperar al cron.

## Tipos de conexión (`core.servicios.tipo_conexion`)

| Valor | Cómo obtiene la IP | Credenciales | Control |
| --- | --- | --- | --- |
| `pppoe` (por defecto) | `Framed-IP-Address` vía RADIUS | `user_ppp` / `pass_ppp` | RADIUS + CoA/Disconnect (sin cambios) |
| `ip_estatica` | Configurada a mano en la antena/CPE | ninguna | API REST de RouterOS |
| `dhcp_fija` | Lease estático en el servidor DHCP del router, amarrado a la `mac` | ninguna; `mac` obligatoria | API REST de RouterOS |

- La IPv4 se asigna desde `network.redes_ipv4` del router como hoy (`red_ipv4_id` opcional); el historial (`asignaciones_historial`) se registra igual.
- `user_ppp`/`pass_ppp` son null fuera de `pppoe`; `aaa` responde Access-Reject si llegara uno.
- Cambiar el tipo de conexión de un servicio existente es una edición con diff (`servicio.config_cambiada` con campo `tipo_conexion`), y el dispatcher limpia lo del tipo anterior en el router.

## Objetos en RouterOS (uno por servicio, identificados por `comment`)

Cada objeto lleva `comment = "argosisp:servicio:<servicio_id>"` para encontrarlo, actualizarlo y reconciliarlo; nunca se identifica por nombre o por IP.

| Objeto | Ruta REST | Cuándo |
| --- | --- | --- |
| Cola simple | `/queue/simple` (`target=<ipv4>/32`, `max-limit=subida/bajada`) | Siempre. Velocidad normal o limitada según el estado |
| Address-list | `/ip/firewall/address-list` (`list=suspendidos`, `address=<ipv4>`) | Solo en `suspendido`. La misma lista y el mismo NAT a `/corte` que PPPoE |
| Lease DHCP | `/ip/dhcp-server/lease` (`mac-address`, `address`, `server` del router) | Solo en `dhcp_fija` |
| ARP estático (amarre) | `/ip/arp` (`address`, `mac-address`, `interface`) | Solo si `amarre_ip_mac = true` (opcional; requiere `arp=reply-only` en la interfaz, documentado en `lab.rsc`) |

## Eventos que consume el dispatcher

Los mismos del catálogo, sin eventos nuevos para el estado: `servicio.creado`, `servicio.estado_cambiado`, `servicio.config_cambiada`, `asignacion.cambiada` y el retiro del servicio. Para cada evento de un servicio con `tipo_conexion != pppoe`, el dispatcher **calcula el estado deseado completo** del servicio y lo aplica en el router: es idempotente, así que un evento repetido o fuera de orden no deja basura.

## Garantías

- **Auditoría:** cada llamada a RouterOS queda en `audit.red` con comando, objeto y respuesta del equipo (regla 9).
- **Fallo del router:** 3 reintentos con backoff; si se agotan, `routeros.fallido { servicio_id, router_id, operacion, error }` por outbox (alerta al equipo por Telegram, A6).
- **Reconciliación:** un job con lock compara cada router contra el estado deseado de sus servicios sin PPPoE (por `comment`) y corrige diferencias, auditándolas. Corre al volver un router caído y periódicamente como red de seguridad (no es una caché: no aplica la regla 5).
- **Credenciales:** usuario y contraseña de la API del router cifrados con `v1` (`api_password`, ya existente); HTTPS con verificación de certificado configurable por router.
