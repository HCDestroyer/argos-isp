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
| Usuario de la API | En el MikroTik | Grupo `argosisp-api` con `read,write,api,rest-api` y nada más (sin `ftp`, `ssh`, `telnet`, `winbox`, `password`, `policy`, `sensitive`). Es el mínimo probado por A6 en CHR 7.24.5: sin `api` la REST responde `not allowed` y sin `rest-api`, 401; `web` no hace falta (`infra/mikrotik/README.md`, «Permisos mínimos de la API»). Usuario `argosisp-api`, con clave aleatoria de 32 caracteres que Argos genera y guarda cifrada en `api_password`, y `address=` la IP del servidor en el túnel. |
| RADIUS | En el MikroTik | `/radius` hacia la IP del servidor en el túnel, con el secreto del NAS (de A2) y `src-address` = la IP del router en el túnel. `/radius incoming` en 3799, solo desde la IP del servidor en el túnel. |

## 2. Puertos

**En el router** (reglas `argosisp:gestion …` al inicio de `input`):
- Aceptar desde `wg-argos`: www-ssl (REST), winbox y ssh solo si están en la lista `argosisp-admin`, y 3799/udp desde la IP del servidor.
- Apagar los servicios que no se usan: `telnet`, `ftp`, `www`, `api`, `api-ssl`, `bandwidth-server`, MAC-Telnet (`/tool mac-server allowed-interface-list=none`) y `romon`. MAC-Winbox se deja: solo funciona en la red local y evita que el técnico quede fuera. Los que quedan (`www-ssl`, `winbox`, `ssh`) llevan `address=` la red del túnel más `argosisp-admin` (`address=` en todas las 7.x; desde 7.17 se muestra como `available-from`).
- El puerto UDP de WireGuard del router no se abre: el router inicia el túnel (keepalive 25 s) y las respuestas entran como conexión establecida.
- La lista `argosisp-admin` (IPs de los administradores) es opcional y se llena desde el panel. Vacía significa gestión solo por el túnel.
- Nunca bloquear al cliente final: estas reglas solo tocan los puertos de gestión del propio router.

**En el servidor:** públicos solo 80/443 (Caddy) y el puerto UDP de WireGuard. RADIUS (1812/1813) se publica en `RADIUS_BIND_IP`, que con WireGuard es la `.1` del túnel. Postgres y Redis nunca. `argosisp estado` avisa si encuentra otro puerto expuesto.

## 3. El script

- `GET /api/v1/routers/:id/script-conexion` devuelve un `.rsc` con el permiso `routers.generar_script`. Opciones: `?admin=` (IPs para `argosisp-admin`) y `?incluir=servicio`, que suma la configuración de PPPoE, perfiles y corte de `infra/mikrotik/lab.rsc`; por defecto solo conexión.
- Cada generación emite un token nuevo (el anterior deja de valer), queda en la auditoría **sin** secretos y emite `router.conexion_generada { router_id, empresa_id, actor }`.
- El script es re-ejecutable: borra y recrea solo lo que lleva comentario `argosisp:`. Requiere RouterOS 7.x (WireGuard nativo) y lo comprueba al inicio.
- Lleva secretos (clave de la API y secreto RADIUS), así que el panel lo descarga y no lo guarda. El texto lo advierte.
- Al registrarse, el router pasa a `conexion.estado = conectado` cuando el servidor ve su handshake (menos de 3 min, §6.3); si no, `pendiente`. `routers.rotar_conexion` invalida el peer y genera un script nuevo.

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

## 6. Detalle de implementación (A6, rama `a6/conexion-routers`)

### 6.1 Registro (A1 implementa, el script de A6 lo llama)

- Petición del router (JSON, `Content-Type: application/json`): `{ token, public_key, routeros_version, api_ca }`. `api_ca` es el PEM de la CA propia del router (`argosisp-ca.crt`) o vacío; Argos lo guarda en `network.routers.api_ca` con `api_tls_verificar = true`, `api_url = https://<ip_tunel>` y `api_usuario = argosisp-api` (el certificado de `www-ssl` lleva `IP:<ip_tunel>` en el SAN).
- Respuesta `200`: `{ router_id, ip_tunel, servidor: { public_key, endpoint, puerto, ip } }`. El script compara `ip_tunel` con la que trae y se detiene si difieren. Token vencido, usado o de otro router → `410` (`application/problem+json`).
- Si el registro falla (sin internet, 410, RouterOS sin `:serialize`/`:deserialize` o sin raíces de confianza para verificar HTTPS), el script aplica todo lo demás con los datos del servidor que ya trae y muestra la clave pública para `POST /routers/:id/conexion/clave`. Probado: 7.24.5 se registra; 7.16.2 se registra solo con la CA de Argos importada (no trae `builtin-trust-store`); 7.12.1 no tiene `:serialize` y cae a la clave pegada.

### 6.2 Script (plantillas de A6, render de A1)

- Plantillas armadas desde `infra/mikrotik/piezas`: `infra/mikrotik/plantillas/conexion.rsc.tpl` y, con `?incluir=servicio`, `conexion-servicio.rsc.tpl` (mismas piezas que `lab.rsc`, sin copia).
- Variables `{{nombre}}` con su patrón en `infra/mikrotik/variables.json`: grupo `conexion` siempre y `servicio` con `?incluir=servicio`. El render (referencia: `infra/mikrotik/render.mjs`) exige todas, valida el patrón, escapa `\ " $ ?` y rechaza caracteres de control. `wg_servidor_public_key` es la que publicó el agente (§6.3) y `wg_servidor_endpoint` / `wg_servidor_puerto` salen de `ARGOSISP_WG_ENDPOINT` / `ARGOSISP_WG_PUERTO` (variables de entorno de la API, junto con `ARGOSISP_WIREGUARD` y `ARGOSISP_WG_RED`).
- Las plantillas son ASCII y sin comentarios dentro del bloque, para pegarlas en New Terminal.

### 6.3 Servidor ↔ API (A6 consume, A1 implementa)

Con `Authorization: Bearer <INTERNAL_TOKEN>` (el de `internal/aaa/*`):

- `GET /api/v1/internal/wireguard/peers` → `{ data: [{ router_id, public_key, ip_tunel }] }`, todos los vigentes, sin paginar. El agente reconcilia la lista completa (no aplica diferencias).
- `POST /api/v1/internal/wireguard/estado` → `204`, cuerpo `{ servidor: { public_key, ip, red, puerto, interfaz, modo }, peers: [{ public_key, ultimo_handshake (ISO o null), endpoint, rx_bytes, tx_bytes }], generado_en }`. Llega cuando cambia algo, como mucho cada 60 s y al menos cada 10 min. Argos guarda la clave del servidor y `ultimo_handshake` por router sin auditoría por fila (telemetría, como el Interim-Update); `conectado` = handshake de menos de 3 min. El cambio pendiente ↔ conectado sí es un hecho (A1 decide si emite evento).
- Eventos que escucha el agente (grupo `wireguard`): `router.conexion_registrada`, `router.conexion_rotada` y **`router.conexion_eliminada`** (propuesta de A6: al borrar o retirar un router con túnel, para quitar su peer; `{ router_id, empresa_id }`). El grupo se crea en `$`: lo anterior lo cubre la reconciliación al arrancar.

### 6.4 RADIUS y CoA por el túnel

- `RADIUS_BIND_IP` = la `.1`; los contenedores alcanzan las `/32` por la ruta del host y salen con origen `.1` (enmascarado de Docker), así que `COA_ORIGEN_IP` queda vacía. Detalle: `infra/wireguard/README.md`.
- El cliente de FreeRADIUS de un router con túnel es su `ip_tunel` (es el origen de sus `Access-Request`): `argosisp radius-clientes` / `clients.d` deben usarla como dirección del NAS (A1/A2).
- **Clientes por evento (A2):** con `AAA_CLIENTES_EVENTOS=1`, cada nodo `aaa` consume `argos:eventos` (grupo `radius-clientes:<nodo>`, en `$`) y, con `router.conexion_registrada`, `router.conexion_rotada` y `router.conexion_eliminada` (y al arrancar), regenera todo `clients.d` desde `network.routers` (`ipaddr = nas_ip`, que A1 deja en `ip_tunel` al registrar). Si cambió algún archivo, avisa por el FIFO `clients.d/.recargar`; el contenedor de FreeRADIUS corre `services/aaa/freeradius/recargar.sh` como entrypoint, valida con `freeradius -C` y reinicia `radiusd` (~1 s; FreeRADIUS 3.2 no relee clientes con HUP). Sin TTL ni sondeo. Detalle: `services/aaa/README.md`, «Clientes por evento».
- **CoA:** destino y secret salen del **router de la sesión** (`network.sesiones.router_id`, fijado por el accounting), con su `nas_ip` y su `radius_secret` **actuales**; solo una sesión sin router se resuelve por `sesiones.nas_ip`. Decisión del líder (29 oct): al registrar el túnel **no se desconecta a nadie**; una sesión abierta con la IP vieja recibe el CoA o el Disconnect por la IP del túnel (`audit.red` guarda además `comando.nas_ip_sesion` con la IP vieja). `coa` no ata el socket a una IP si `COA_ORIGEN_IP` está vacía: el origen lo pone la ruta y, con el enmascarado del host, es la `.1` (`services/coa/test/nas.test.ts`, «origen de los CoA»). Pruebas: `apps/api/tests/network/coa.spec.ts`.
- **Cambios de RADIUS del router:** `router.radius_cambiado { router_id, empresa_id, campos[] }` (A1, al crear o editar un router con cambios en `nas_ip` o `radius_secret`) también regenera y recarga los clientes; ya no hace falta `argosisp radius-clientes`.


## 7. API de A1 (rama `a1/conexion-routers`)

| Endpoint | Permiso | Respuesta |
| --- | --- | --- |
| `GET /api/v1/routers/:id/script-conexion?admin=&incluir=servicio` | `routers.generar_script` | `text/plain` (descarga `argosisp-router-<id>.rsc`, `Cache-Control: no-store`). 422 `radius_secret_requerido`, `servicio_incompleto`, `red_tunel_llena`; 503 `wireguard_no_configurado`, `plantillas_no_disponibles` |
| `GET /api/v1/routers/:id/conexion` | `routers.ver` | `ConexionRouter`: `estado` (`sin_configurar`, `pendiente`, `conectado` = handshake < 3 min), `ip_tunel`, `public_key`, `ultimo_handshake`, `handshake_reciente`, `registrado_en`, `routeros_version`, `token_vence`, `version` |
| `POST /api/v1/routers/conexion/registrar` | público, token | §6.1. 410 `token_invalido`, 409 `clave_en_uso`, 429 |
| `POST /api/v1/routers/:id/conexion/clave` `{ public_key }` | `routers.conexion_clave` | `ConexionRouter`. 422 `script_no_generado` |
| `POST /api/v1/routers/:id/conexion/rotar?admin=&incluir=` | `routers.rotar_conexion` | `text/plain` (script nuevo) |
| `GET /api/v1/internal/wireguard/peers`, `POST /api/v1/internal/wireguard/estado` | `INTERNAL_TOKEN` | §6.3 (`204` en el estado) |

- La clave nueva de `argosisp-api` se guarda cifrada como pendiente al generar y pasa a `api_password` cuando el router se registra con ese script (un script generado y no ejecutado no corta la API).
- `?incluir=servicio`: el grupo `servicio` de `variables.json` sale del entorno de la API (`ROUTERS_SERVICIO_<NOMBRE>`; `pppoe_interfaz` de `interfaz_clientes` del router). Nunca se inventan rangos: si falta alguno, 422 `servicio_incompleto` con la lista.
- Render: port de `render.mjs` en `apps/api/app/network/conexion/render.ts`, con espejo de `render.test.mjs`. Los archivos se leen de `ROUTERS_MIKROTIK_DIR` (imagen) o de `infra/mikrotik`.
- `router.conexion_eliminada { router_id, empresa_id }`: al desactivar un router con túnel (no hay borrado de routers); al reactivarlo, otra vez `router.conexion_registrada`. Un router inactivo no sale en los peers.
- El cambio `pendiente` ↔ `conectado` no emite evento (nadie lo consume): queda en `audit.cambios`.
- `router.radius_cambiado { router_id, empresa_id, campos[] }` (`campos` ⊂ `nas_ip`, `radius_secret`; nunca el secreto): sale al crear un router, al editar alguno de esos dos campos y al registrarse por el túnel (cambia `nas_ip`). A2 lo escucha para regenerar el cliente de FreeRADIUS.
