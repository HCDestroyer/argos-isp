# Contrato · Script de conexión de routers y túnel WireGuard

Pedido del PM (28 oct): conectar un MikroTik a Argos con un script generado desde el panel. El script crea el túnel WireGuard, el usuario de la API con sus permisos y el cliente RADIUS, y no deja abiertos los puertos que no hacen falta. Lo cumplen A6 (servidor WireGuard, instalador, plantilla `.rsc`, puertos del servidor), A1 (API: conexión del router, claves, IPs del túnel, script, permisos), A2 (RADIUS y CoA por el túnel) y A4 (pantalla). Cada uno lo cambia en la misma PR que su código.

## 1. Piezas

| Pieza | Dónde | Regla |
| --- | --- | --- |
| Servidor WireGuard | Servicio `wireguard` del compose (A6), perfil activable con `ARGOSISP_WIREGUARD=1` | Interfaz `wg-argos` en el host. Escucha `ARGOSISP_WG_PUERTO` (UDP, 51820 por defecto); es el único puerto nuevo que se publica. Red del túnel `ARGOSISP_WG_RED` (por defecto `10.255.0.0/16`); el servidor es la `.1`. |
| Peers | API (A1) → servidor (A6) | Argos guarda cada peer en `network.routers_conexion` y el servicio `wireguard` aplica la lista sin reiniciarse (`wg syncconf`), por evento, nunca por TTL ni sondeo. |
| IP del túnel | IPAM de A1 | Una `/32` por router, de `ARGOSISP_WG_RED`, única y estable mientras el router exista. |
| Clave privada del router | En el MikroTik | **Nunca sale del router.** El script crea la interfaz, lee su `public-key` y la registra en Argos. |
| Registro | `POST /api/v1/routers/conexion/registrar` (sin sesión, con token) | Token de un solo uso, ligado al router, válido 24 h y guardado con hash. El router manda `{ token, public_key }` y Argos responde con la clave pública del servidor y su endpoint. El script añade el peer con esos datos. Token vencido o usado → 410. Si el router no tiene internet, el panel acepta pegar la `public_key` a mano (`POST /routers/:id/conexion/clave`). |
| Usuario de la API | En el MikroTik | Grupo `argosisp-api` con `read,write,api,rest-api` y nada más (sin `ftp`, `ssh`, `telnet`, `winbox`, `password`, `policy`, `sensitive` salvo que la API lo requiera; A6 documenta el mínimo probado). Usuario `argosisp-api`, con clave aleatoria de 32 caracteres que Argos genera y guarda cifrada en `api_password`, y `address=` la IP del servidor en el túnel. |
| RADIUS | En el MikroTik | `/radius` hacia la IP del servidor en el túnel, con el secreto del NAS (de A2) y `src-address` = la IP del router en el túnel. `/radius incoming` en 3799, solo desde la IP del servidor en el túnel. |

## 2. Puertos

**En el router** (reglas `argosisp:gestion …` al inicio de `input`):
- Aceptar desde `wg-argos`: www-ssl (REST), winbox y ssh solo si están en la lista `argosisp-admin`, y 3799/udp desde la IP del servidor.
- Apagar los servicios que no se usan: `telnet`, `ftp`, `www`, `api`, `api-ssl`, `bandwidth-server`, el MAC-server fuera de la lista y `romon`. Los que quedan (`www-ssl`, `winbox`, `ssh`) llevan `address=` la red del túnel más `argosisp-admin`.
- La lista `argosisp-admin` (IPs de los administradores) es opcional y se llena desde el panel. Vacía significa gestión solo por el túnel.
- Nunca bloquear al cliente final: estas reglas solo tocan los puertos de gestión del propio router.

**En el servidor:** públicos solo 80/443 (Caddy) y el puerto UDP de WireGuard. RADIUS (1812/1813) se publica en `RADIUS_BIND_IP`, que con WireGuard es la `.1` del túnel. Postgres y Redis nunca. `argosisp estado` avisa si encuentra otro puerto expuesto.

## 3. El script

- `GET /api/v1/routers/:id/script-conexion` devuelve un `.rsc` con el permiso `routers.generar_script`. Opciones: `?admin=` (IPs para `argosisp-admin`) y `?incluir=servicio`, que suma la configuración de PPPoE, perfiles y corte de `infra/mikrotik/lab.rsc`; por defecto solo conexión.
- Cada generación emite un token nuevo (el anterior deja de valer), queda en la auditoría **sin** secretos y emite `router.conexion_generada { router_id, empresa_id, actor }`.
- El script es re-ejecutable: borra y recrea solo lo que lleva comentario `argosisp:`. Requiere RouterOS 7.x (WireGuard nativo) y lo comprueba al inicio.
- Lleva secretos (clave de la API y secreto RADIUS), así que el panel lo descarga y no lo guarda. El texto lo advierte.
- Al registrarse, el router pasa a `conexion.estado = conectado` cuando el servidor ve su handshake; si no, `pendiente`. `routers.rotar_conexion` invalida el peer y genera un script nuevo.

## 4. Permisos y eventos

- Permisos nuevos:
    - `routers.generar_script` (admin, tecnico);
    - `routers.rotar_conexion` (admin);
    - `routers.conexion_clave` (admin, tecnico), para pegar la clave a mano.
- Eventos nuevos:
    - `router.conexion_generada`;
    - `router.conexion_registrada { router_id, empresa_id, ip_tunel }`, que el servicio `wireguard` consume para aplicar el peer;
    - `router.conexion_rotada`.

## 5. Pantalla (A4)

- En la ficha del router, la sección «Conexión» muestra el estado (pendiente o conectado, último handshake, IP del túnel).
- El botón «Script de conexión» abre un modal: IPs de administración, «incluir configuración de servicio», descargar o copiar, y los pasos en lenguaje simple (abrir Winbox → New Terminal → pegar → verificar).
- Los botones «Rotar» y «Pegar clave pública» llevan sus permisos.

## 6. API de A1 (hecho en `a1/conexion-routers`)

| Endpoint | Permiso | Respuesta |
| --- | --- | --- |
| `GET /api/v1/routers/:id/script-conexion?admin=&incluir=servicio` | `routers.generar_script` | `text/plain` (descarga `argosisp-router-<id>.rsc`, `Cache-Control: no-store`). 422 `radius_secret_requerido`, 422 `red_tunel_llena`, 503 `wireguard_no_configurado` |
| `GET /api/v1/routers/:id/conexion` | `routers.ver` | `ConexionRouter`: `estado` (`sin_configurar`, `pendiente`, `conectado`), `ip_tunel`, `public_key`, `ultimo_handshake`, `handshake_reciente` (< 180 s), `registrado_en`, `token_vence`, `version` |
| `POST /api/v1/routers/conexion/registrar` | público, token | `RegistroConexion`: `ip_tunel`, `ip_tunel_cidr`, `servidor_ip`, `servidor_public_key`, `servidor_endpoint`, `servidor_puerto`. 410 `token_invalido`, 409 `clave_en_uso`, 429 |
| `POST /api/v1/routers/:id/conexion/clave` `{ public_key }` | `routers.conexion_clave` | `ConexionRouter`. 422 `script_no_generado` |
| `POST /api/v1/routers/:id/conexion/rotar?admin=&incluir=` | `routers.rotar_conexion` | `text/plain` (script nuevo) |
| `GET /api/v1/internal/routers/conexion/peers` | `INTERNAL_TOKEN` | `[{ router_id, public_key, ip_tunel }]` para `wg syncconf` (allowed-ips = `ip_tunel/32`) |
| `POST /api/v1/internal/routers/conexion/handshakes` `{ peers: [{ public_key, ultimo_handshake }] }` | `INTERNAL_TOKEN` | `{ actualizados, conectados[] }` |

- La clave nueva de `argosisp-api` se guarda cifrada como pendiente al generar y pasa a `api_password` cuando el router se registra con ese script. Al registrarse, `host` y `nas_ip` del router pasan a la IP del túnel (`src-address` del RADIUS y destino del CoA).
- El secreto RADIUS del script es `network.routers.radius_secret` (el que usa `pnpm aaa:clients`); nunca se genera otro.
- Variables: `ARGOSISP_WG_RED`, `ARGOSISP_WG_PUERTO`, `ARGOSISP_WG_ENDPOINT`, `ARGOSISP_WG_CLAVE_PUBLICA` o `ARGOSISP_WG_CLAVE_PUBLICA_ARCHIVO`, `ROUTERS_PLANTILLA_CONEXION`, `ROUTERS_REGISTRO_LIMITE`, `ROUTERS_REGISTRO_VENTANA_S` (`apps/api/.env.example`).

### Formato de la plantilla `.rsc` (A1 ↔ A6)

- `{{nombre}}`: valor escapado para ir dentro de comillas dobles (`:local x "{{nombre}}"`); también vale en comentarios (los saltos de línea salen como `\0A`).
- `{{lista:admin_ips}}`: arreglo literal `{"a";"b"}` (o `{}`), sin comillas alrededor.
- `{{#seccion}}…{{/seccion}}` y `{{^seccion}}…{{/seccion}}`.
- Variables: `router_id`, `router_nombre`, `generado_en`, `token_vence`, `ip_tunel`, `ip_tunel_cidr`, `red_tunel`, `servidor_ip`, `servidor_public_key`, `servidor_endpoint`, `servidor_puerto`, `registro_url`, `registro_token`, `api_usuario`, `api_grupo`, `api_password`, `radius_secret`. Lista: `admin_ips`. Secciones: `radius` (router en modo radius), `incluir_servicio` (`?incluir=servicio`), `admin` (hay IPs de administración).
- Un marcador desconocido es error 500 al generar: la plantilla y la API cambian juntas.
- La API busca la plantilla en `ROUTERS_PLANTILLA_CONEXION`, luego en `infra/mikrotik/conexion.rsc` y si no usa la mínima (`apps/api/app/network/conexion/plantilla_minima.ts`). En la imagen de la API, A6 copia su `.rsc` y define `ROUTERS_PLANTILLA_CONEXION`.
- El registro desde el router: `POST` JSON `{"token":"…","public_key":"…"}` a `registro_url` (`/tool fetch … http-method=post`).
