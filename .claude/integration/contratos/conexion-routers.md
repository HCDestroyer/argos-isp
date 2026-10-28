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
