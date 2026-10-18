# Proxy público (perfil `publico`)

Caddy con TLS automático delante de la API y del panel. El portal **no** pasa por aquí: se publica directo (`PORTAL_BIND_IP`) para que la API vea la IP real del cliente suspendido (`infra/README.md`, "Portal: IP real del cliente"). Su HTTPS va por un proxy propio en esa misma IP: "Portal por HTTPS", abajo.

| Dominio (`infra/.env`) | Va a | Notas |
| --- | --- | --- |
| `PROXY_DOMINIO_API` (`api.localhost`) | `api:3333` | Incluye `POST /api/v1/pasarela/webhook/<proveedor>` con el cuerpo crudo (abajo) |
| `PROXY_DOMINIO_PANEL` (`panel.localhost`) | `web:3000` | |

```sh
# infra/.env: PROXY_DOMINIO_API=api.isp.example, PROXY_DOMINIO_PANEL=panel.isp.example,
# PROXY_BIND_IP=<IP pública>, PROXY_HTTP_PORT=80, PROXY_HTTPS_PORT=443,
# API_PUBLIC_URL=https://api.isp.example (y PASARELA_URL_PUBLICA si usas la pasarela falsa)
COMPOSE_PROFILES=publico docker compose -f infra/docker-compose.yml up -d proxy
```

Con dominios públicos (DNS apuntando a `PROXY_BIND_IP`, puertos 80 y 443 abiertos) Caddy pide el certificado a Let's Encrypt. Con `*.localhost` usa su CA interna (laboratorio). Los certificados viven en el volumen `caddydata`.

Por defecto escucha en `127.0.0.1:8080` y `:8443` para no chocar con el puerto 80 del portal (`PORTAL_BIND_IP`). En producción usa la IP pública con 80 y 443; el portal queda en la IP de la LAN o del túnel hacia los MikroTik.

## Webhook de la pasarela: cuerpo crudo

La pasarela firma el webhook con HMAC sobre el cuerpo **tal como lo envía** (`a3.md`, `app/billing/pasarelas`). Si un proxy lo reformatea (normaliza el JSON, cambia el charset, descomprime, agrega un salto de línea) la firma deja de coincidir y la API responde 401 `firma_invalida`: el pago no se registra.

El `Caddyfile` trata `/api/v1/pasarela/webhook/*` aparte: `reverse_proxy` sin `encode`, sin reescrituras y con `flush_interval -1`; `request_body` solo limita el tamaño (1 MB). No agregues ahí WAF, normalización ni compresión. Si se usa otro proxy (nginx, un balanceador del proveedor), las mismas reglas: en nginx, `proxy_pass` sin `proxy_set_body`, sin `gunzip on` y con `proxy_request_buffering off` en esa ruta.

**Prueba** (`infra/proxy/probar-webhook.sh`, también en CI): levanta Caddy con este `Caddyfile` y una "API" de eco que verifica la firma como la pasarela falsa, y manda por HTTPS un JSON con espacios, acentos y escapes, un formulario, un cuerpo con `Content-Encoding: gzip` y uno de 200 KB. Los bytes y la firma llegan intactos; una firma alterada vuelve como 401.

La prueba arranca cada vez con el almacenamiento de Caddy vacío y apaga la limpieza de almacenamiento (`PROXY_LIMPIEZA_ALMACEN=off`; `probar-portal.sh` hace lo mismo con `PORTAL_PROXY_LIMPIEZA_ALMACEN`). Con la limpieza activa, la prueba fallaba en ~0,5 % de las corridas con `tlsv1 alert internal error` (SSL alert 80). Al arrancar, la limpieza corre a la vez que la emisión con la CA interna. Si lista `certificates/local/` justo cuando `api.localhost/` ya existe pero todavía está vacía, borra la carpeta, y la emisión falla con `failed to create temp file ... no such file or directory`. Caddy reintenta 60 s después y mientras tanto no hay certificado para ese dominio. Fuera de las pruebas el valor sigue siendo el de Caddy (24 h); con Let's Encrypt la emisión tarda segundos y no coincide con la limpieza. Además, el cliente espera a que el handshake TLS con `api.localhost` funcione, con un máximo de 20 s, porque el healthcheck del proxy solo mira la API de administración, que responde antes de que exista el certificado.

## Portal por HTTPS

El portal del cliente tiene su propio proxy (`portal-proxy`, `Caddyfile.portal`), aparte del de la API y el panel porque se publica en otra IP (`PORTAL_BIND_IP`, la que el MikroTik usa para el dst-nat de los suspendidos y que está en el walled garden). Se activa con el archivo de override:

```sh
docker compose -f infra/docker-compose.yml -f infra/docker-compose.portal-https.yml up -d
```

| Por | Qué responde |
| --- | --- |
| HTTP (`PORTAL_BIND_IP:80`), cualquier `Host` | Todo, igual que antes: `/corte` del dst-nat, sondas de portal cautivo, la página por IP. **No** se redirige a HTTPS: el portal cautivo no puede ir por HTTPS |
| HTTP, `Host` = `PORTAL_DOMINIO`, rutas `/entrar` y `/cuenta` (y debajo) | `308` a `https://PORTAL_DOMINIO/...` |
| HTTPS (`PORTAL_BIND_IP:443`), `PORTAL_DOMINIO` | Todo el portal, con `Strict-Transport-Security: max-age=PORTAL_HSTS_MAX_AGE` |

Además, el override deja al portal sin puertos propios (todo entra por el proxy) y pone `PORTAL_COOKIE_SEGURA=siempre` en la API: la cookie de sesión lleva `Secure` y solo viaja por HTTPS. Fuera del override, `PORTAL_COOKIE_SEGURA` (por defecto `auto`) se puede fijar en `infra/.env`.

**IP real del cliente**: no cambia. Los puertos del proxy se publican por iptables (daemon sin `userland-proxy`, `infra/README.md`), Caddy ve la IP del cliente, descarta el `X-Forwarded-For` que traiga (no tiene `trusted_proxies`) y pone la suya; el portal agrega la IP de Caddy, que está en la red de compose (`PORTAL_PROXIES_CONFIABLES`), y la API toma la del cliente. Por IPv6, igual que antes: agregar `"[<portalV6>]:80:80"` y `"[<portalV6>]:443:443"` a `ports` de `portal-proxy`.

### Poner el certificado real

1. Dominio del portal en el DNS que usan los clientes (el del ISP) apuntando a `portalV4` (y `portalV6`), y en el walled garden del MikroTik (`portalFqdn` de `lab.rsc`; el portal acepta cualquier puerto).
2. En `infra/.env`:
    - `PORTAL_DOMINIO=portal.isp.example`; agregarlo también a `PORTAL_HOSTS`.
    - `PORTAL_URL_PUBLICA=http://portal.isp.example` (destino de los 302 a `/corte`: se queda en HTTP; los enlaces a `/entrar` suben solos a HTTPS).
    - Certificado, una de tres:
        - **Archivos** (certificado comprado o de la CA del ISP): copiar `portal.crt` (con la cadena intermedia) y `portal.key` a `PORTAL_TLS_DIR` (por defecto `infra/proxy/portal-certs/`, ignorado por git; llave con permisos 0600) y poner `PORTAL_TLS=/certs/portal.crt /certs/portal.key`. Al renovarlo: reemplazar los archivos y `docker compose ... restart portal-proxy`.
        - **Let's Encrypt**: `PORTAL_TLS=<correo>`. Solo si `PORTAL_DOMINIO` resuelve en internet a esta máquina y el 80 llega desde internet (HTTP-01). Casi nunca es el caso del portal (está en la LAN o el túnel hacia los MikroTik).
        - **Laboratorio**: `PORTAL_TLS=internal` (CA propia de Caddy; el navegador avisa).
    - `PORTAL_HSTS_MAX_AGE=300` al estrenar el certificado. Cuando `/entrar` y `/cuenta` funcionen por HTTPS desde un teléfono del laboratorio, subirlo a `31536000` (un año). Con HSTS el navegador ya no abre el portal sin un certificado válido: no subirlo antes de tener la renovación resuelta.
3. `docker compose -f infra/docker-compose.yml -f infra/docker-compose.portal-https.yml up -d portal portal-proxy api`.
4. Comprobar: `curl -I http://portal.isp.example/corte` (200, sin redirección), `curl -I http://portal.isp.example/entrar` (308 a https), `curl -I https://portal.isp.example/entrar` (200 con `strict-transport-security`), y entrar con un código: la cookie `argos_portal` sale con `Secure`.

**Prueba** (`infra/proxy/probar-portal.sh`, también en CI): levanta `Caddyfile.portal` con un portal de eco y comprueba `/corte` por HTTP con cualquier `Host`, el 308 de `/entrar` y `/cuenta` solo en el dominio, HSTS y `X-Forwarded-Proto: https` por HTTPS, y que un `X-Forwarded-For` falso del cliente se descarta. **Pendiente de laboratorio**: el teléfono suspendido sigue aterrizando en `/corte` con el proxy delante y `quien-soy` lo identifica por IPv4 e IPv6.
