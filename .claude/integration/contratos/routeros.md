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

## Conexión del router (`network.routers`, A1)

Columnas que lee el cliente REST de A2 (`app/network/routeros/consultas.ts` → `routerDispatcher`). Todas se editan con `POST /routers` y `PUT /routers/:id` (permisos `routers.crear` / `routers.editar`) y salen en la vista `Router`.

| Columna | Tipo | Por defecto | Significado |
| --- | --- | --- | --- |
| `host` | `text` NOT NULL | — | Host o IP del router; sin `api_url` la URL es `https://<host>` |
| `api_usuario` | `text` | null | Usuario de la API REST |
| `api_password` | `text` (cifrado `v1`, `AAA_PPP_KEY`) | null | Nunca sale por la API (`tiene_api_password`); `***` en auditoría |
| `api_url` | `text`, CHECK `^https?://host(:puerto)?/?$` | null | URL base explícita (`https://10.0.0.1:8443`); sin ruta. null = `https://<host>` |
| `api_tls_verificar` | `boolean` NOT NULL | `true` | Verificar el certificado TLS del router. Al ser NOT NULL, `ROUTEROS_TLS_VERIFICAR` ya no se aplica a routers con la columna: para un certificado autofirmado, cargar `api_ca` o poner `false` en ese router |
| `api_ca` | `text`, CHECK empieza con `-----BEGIN CERTIFICATE-----` | null | CA en PEM para validar el certificado propio del router. Sale en la vista (es pública); en `audit.cambios` y `audit.acciones.entrada` se registra como `***` |
| `dhcp_servidor` | `text` (1–100) | null | `server` del lease de `dhcp_fija`; null = `ROUTEROS_DHCP_SERVIDOR` o `all` |
| `interfaz_clientes` | `text` (1–100) | null | Interfaz del ARP estático del amarre IP-MAC; null = `ROUTEROS_INTERFAZ_CLIENTES`; sin ninguno no se crea el ARP |

Reglas:

- Los cambios de estas columnas no emiten evento (no cambian el estado deseado de ningún servicio); el siguiente comando o la reconciliación leen el valor nuevo de Postgres. `dhcp_servidor` e `interfaz_clientes` sí cambian objetos en el router: la reconciliación periódica los corrige.
- La precedencia para `dhcp_servidor` / `interfaz_clientes` es: columna del router → `PredeterminadosRed` del llamador → entorno (`ROUTEROS_*`) → `all` / sin ARP.
