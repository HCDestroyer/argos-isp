# Runbook · Argos detrás de Nginx Proxy Manager (u otro proxy)

Para el operador que instala ArgosIsp en un servidor donde **Nginx Proxy Manager (NPM)**, u otro proxy (nginx, Traefik, un balanceador), ya ocupa los puertos 80 y 443 con sus dominios y sus certificados de Let's Encrypt. La instalación normal está en `instalacion.md`; aquí solo cambia lo que hace falta para quedar detrás del proxy.

## Cómo queda

```
navegador ──443──▶ NPM (Let's Encrypt) ──https──▶ Caddy de Argos :8443 ──▶ api / web / portal
suspendido ──80 (dst-nat del MikroTik)──────────▶ Caddy de Argos :8080 ──▶ /corte
MikroTik ──UDP 1812/1813 y CoA 3799─────────────▶ FreeRADIUS / coa (directo, sin NPM)
```

- NPM termina el TLS público. El Caddy de Argos escucha en 8080 (HTTP) y 8443 (HTTPS, con su CA interna) y sigue repartiendo por `Host` igual que sin NPM.
- **La IP real del cliente.** Detrás de NPM, Caddy recibe todas las conexiones desde la IP de NPM. Sin más, el portal no reconoce al cliente (`quien-soy`), el límite por IP del portal lo comparten todos los clientes y la auditoría del portal registra la IP de NPM. `ARGOSISP_PROXIES_CONFIABLES` le dice a Caddy de qué IP viene NPM:
  - Si la conexión viene de esa lista, Caddy toma la IP del cliente de `X-Forwarded-For` (de derecha a izquierda, saltando proxies de la lista; lo que el cliente haya escrito a la izquierda no cuenta) o, si falta, de `X-Real-IP`. NPM manda los dos.
  - Si la conexión viene de cualquier otra IP, Caddy ignora esos encabezados y usa la IP del socket. Así ocurre con un suspendido que llega por el dst-nat o con alguien que llama directo al 8443.
  - Hacia la API, Caddy manda `X-Forwarded-For` **solo con la IP ya resuelta**. La API confía en Caddy porque está en la red de compose (`PORTAL_PROXIES_CONFIABLES`, que por defecto es `COMPOSE_SUBNET_V4`,`COMPOSE_SUBNET_V6`). La cadena completa queda así: cliente → NPM → Caddy → (portal) → API.
  - Vacía (el valor por defecto), no se confía en nadie y todo funciona como antes.

## 1. Saber de qué IP llega NPM

Es la IP que **Caddy ve** como origen. No siempre coincide con la de NPM:

| Dónde corre NPM | Valor de `ARGOSISP_PROXIES_CONFIABLES` |
| --- | --- |
| En Docker, en este mismo servidor (lo normal) | `172.30.0.1/32`, la puerta de enlace de la red de compose de Argos (`COMPOSE_SUBNET_V4`, por defecto `172.30.0.0/24`). Docker hace NAT (masquerade) del tráfico que sale de la red de NPM hacia otra red, así que Caddy no ve la IP del contenedor de NPM. Si cambiaste `COMPOSE_SUBNET_V4`, usa su `.1` (con `COMPOSE_SUBNET_V4=10.255.252.0/26`, `10.255.252.1/32`). `instalar.sh` acepta `COMPOSE_SUBNET_V4`/`COMPOSE_SUBNET_V6` en el entorno y las deja en el `.env` |
| Instalado en el servidor, sin Docker (o NPM con `network_mode: host`) | La IP del servidor a la que NPM se conecta (la del Proxy Host, abajo) |
| En otra máquina | Su IP tal como llega a este servidor (la de la LAN o del túnel; si hay NAT en medio, la del NAT) |

Separa varias entradas con espacios; el instalador también acepta comas. Usa IP sueltas o redes pequeñas. **Nunca pongas las redes de los clientes**: cualquiera de esa lista podría hacerse pasar por otra IP.

`172.30.0.1/32` significa confiar en todo lo que llega a Caddy desde este mismo servidor: procesos locales que entran por `127.0.0.1:8443` y otros contenedores. Es aceptable porque quien controla el servidor ya controla Argos. Por eso los puertos de Argos se publican solo en IPv4 (`ARGOSISP_BIND_IP=0.0.0.0`, el valor por defecto). Si los publicas también en IPv6, Docker reenvía esas conexiones desde la misma puerta de enlace y un cliente externo por IPv6 podría falsificar su IP.

Si no estás seguro, instala con el valor que creas correcto y comprueba con el paso 6. La respuesta dice exactamente qué IP ve Caddy.

## 2. Instalar

Con NPM ocupando 80 y 443, el instalador solo revisa que 8080 y 8443 (y UDP 1812/1813) estén libres:

```sh
curl -fsSL https://github.com/HCDestroyer/argos-isp/releases/latest/download/instalar.sh | \
  sudo ARGOSISP_HTTP_PORT=8080 ARGOSISP_HTTPS_PORT=8443 ARGOSISP_TLS=interno \
       ARGOSISP_PROXIES_CONFIABLES=172.30.0.1/32 \
       bash -s -- --dominio miisp.com.gt --correo admin@miisp.com.gt --si
```

- `ARGOSISP_TLS=interno` es obligatorio detrás de NPM. Los retos de Let's Encrypt llegan a NPM, no a Caddy, así que Caddy usa su CA interna y el certificado público lo pone NPM. El instalador avisa si falta.
- El instalador escribe las tres variables en `/opt/argosisp/.env`. El mensaje final muestra las URL sin puerto (se entra por los dominios de NPM) y `/corte` en `http://<IP del servidor>:8080/corte`.
- Para cambiar el valor después, edita `ARGOSISP_PROXIES_CONFIABLES="…"` en `/opt/argosisp/.env` (separado por **espacios**: con comas Caddy no arranca) y corre `sudo argosisp levantar`.
- Firewall: 8080 y 8443 solo tienen que ser alcanzables desde NPM y desde los MikroTik (el dst-nat de los suspendidos llega al 8080). No hace falta abrirlos a internet.

## 3. Proxy Hosts en NPM

Crea uno por dominio: `panel.<dominio>`, `api.<dominio>` y `portal.<dominio>`. Los registros DNS públicos apuntan a NPM.

| Campo | Valor |
| --- | --- |
| Scheme | `https`, porque en `http` el Caddy de Argos redirige el panel y la API a HTTPS y se forma un bucle |
| Forward Hostname / IP | La IP del servidor de Argos (con NPM en Docker en el mismo servidor, la IP de la LAN del servidor o la puerta de enlace de la red de NPM, p. ej. `172.17.0.1`; nunca `127.0.0.1`, que dentro del contenedor es NPM) |
| Forward Port | `8443` |
| Websockets Support | Activado |
| Block Common Exploits | Opcional. No cambia el cuerpo de las peticiones |
| SSL | Certificado de Let's Encrypt pedido en NPM. **Force SSL** y HTTP/2 activados en `panel.` y `api.`; en `portal.` **sin Force SSL**, porque `/entrar` y `/cuenta` ya redirigen a HTTPS desde Caddy y el resto del portal tiene que poder abrirse por HTTP (portal cautivo) |

- **Host original.** Caddy decide el sitio por el `Host` (`panel.`, `api.` o `portal.`). NPM lo manda tal cual por defecto (`proxy_set_header Host $host`); no lo cambies en "Custom locations" ni en "Advanced". Con otro proxy, configúralo igual (en nginx, `proxy_set_header Host $host;`).
- **SNI.** NPM se conecta a Caddy por TLS **sin SNI** (`proxy_ssl_server_name off`, su valor por defecto) y sin verificar el certificado (la CA interna de Caddy). Desde la versión 1.4.1, Caddy responde a un saludo sin SNI con el certificado de `DOMINIO_API` (`default_sni` en `config/Caddyfile`) y enruta por el `Host` igual que siempre. **Hasta la 1.4.0 no:** Caddy corta el saludo con `tlsv1 alert internal error` y NPM da 502 (ver Problemas). En cualquier versión puedes mandar el SNI agregando en "Advanced" de cada Proxy Host:

  ```nginx
  proxy_ssl_server_name on;
  proxy_ssl_name $host;
  ```
- **Encabezados de IP.** NPM manda `X-Forwarded-For` y `X-Real-IP` por defecto; no los quites.

## 4. Página de corte (MikroTik)

El dst-nat de TCP/80 de los suspendidos va **al puerto HTTP de Argos (8080), nunca a NPM**. Llega con cualquier `Host` (el del sitio que el cliente quería abrir) y NPM no tiene un Proxy Host para ese dominio. En `infra/mikrotik/lab.rsc` es la variable `portalCortePuerto`:

```routeros
:local portalV4 "<IP del servidor de Argos>"
:local portalCortePuerto 8080
```

Si la regla ya existe en el router, cámbiala:

```routeros
/ip firewall nat set [find comment="argosisp: corte-nat HTTP a /corte"] to-addresses=<IP del servidor de Argos> to-ports=8080
```

En el walled garden (`argos-portal`) quedan la IP del servidor y `portal.<dominio>` (`portalFqdn`). Si el cliente suspendido abre `https://portal.<dominio>`, entra por NPM, y Caddy ve su IP real gracias a `ARGOSISP_PROXIES_CONFIABLES`. El resto de la configuración del router está en `infra/mikrotik/README.md`.

## 5. Lo que no cambia

- **Webhooks de la pasarela (Recurrente):** `https://api.<dominio>/api/v1/pasarela/webhook/recurrente` pasa por NPM sin cambios. La firma va sobre el cuerpo crudo: NPM normalmente no lo toca. No agregues en "Advanced" `proxy_set_body`, `gunzip on` ni filtros que reescriban el cuerpo. Si sale `firma_invalida` (401) en los registros de la API, revisa eso primero (`infra/proxy/README.md`, "Webhook de la pasarela: cuerpo crudo").
- **RADIUS (UDP 1812/1813) y CoA (UDP 3799):** no pasan por NPM, que es solo HTTP. Los MikroTik hablan directo con el servidor (`RADIUS_BIND_IP`, `infra/mikrotik/README.md`).

## 6. Verificar la IP real

Desde un equipo **fuera** del servidor (tu PC o un teléfono con datos):

```sh
curl -s https://api.<dominio>/api/v1/portal/quien-soy        # {"identificado":false,"ip":"<tu IP pública>",...}
curl -s https://portal.<dominio>/api/v1/portal/quien-soy     # lo mismo, pasando por el portal
```

- `ip` es la IP con la que la API identificó la petición. Tiene que ser **tu IP pública**: compárala con la que muestra cualquier sitio de "cuál es mi IP".
- Si sale `172.30.0.1` u otra IP privada, esa es la IP desde la que Caddy ve a NPM. Ponla en `ARGOSISP_PROXIES_CONFIABLES` (paso 1), corre `sudo argosisp levantar` y repite.
- Desde un cliente suspendido del laboratorio, `http://example.com/` debe mostrar `/corte` con sus datos. Eso prueba el dst-nat al 8080.
- En los registros: `sudo argosisp logs api-portal` (o `api` si `ARGOSISP_API_PORTAL=no`) muestra las consultas del portal; la acción `portal.*` queda en `audit.acciones` con la `ip` en `entrada`.

## Problemas

| Síntoma | Qué hacer |
| --- | --- |
| `quien-soy` devuelve la IP de NPM (o `172.30.0.1`) | Falta esa IP en `ARGOSISP_PROXIES_CONFIABLES`, o el `.env` no se aplicó: edítalo y corre `sudo argosisp levantar` |
| La página de corte o `quien-soy` muestran como cliente una IP de la red de compose que no es la `.1` (p. ej. «Conexión desde 10.255.252.20», la de Caddy) y la instalación usa otra `COMPOSE_SUBNET_V4` | Argos ≤ 1.4.0: la API solo confiaba en `172.30.0.0/24` aunque la red fuera otra. Actualiza (`sudo argosisp actualizar`) o, mientras tanto, agrega al `.env` `PORTAL_PROXIES_CONFIABLES=<COMPOSE_SUBNET_V4>,fd00:a6:30::/64` (p. ej. `PORTAL_PROXIES_CONFIABLES=10.255.252.0/26,fd00:a6:30::/64`) y corre `sudo argosisp levantar`. Desde la 1.4.1 sigue sola a `COMPOSE_SUBNET_V4`/`COMPOSE_SUBNET_V6`; quita esa línea al actualizar si la pusiste |
| Caddy no arranca después de editar el `.env` (`parsing CIDR expression`) | La lista lleva comas o una entrada mal escrita. Sepárala con espacios: `ARGOSISP_PROXIES_CONFIABLES="172.30.0.1/32 192.0.2.10"` |
| 502 en NPM y, desde el host de NPM, `curl -kI https://<IP del servidor>:8443 -H 'Host: panel.<dominio>'` da `curl: (35) … tlsv1 alert internal error` (con `--resolve panel.<dominio>:8443:<IP del servidor> https://panel.<dominio>:8443` sí responde) | Argos ≤ 1.4.0: Caddy no acepta TLS sin SNI y NPM se conecta sin SNI. Actualiza (`sudo argosisp actualizar`) o, mientras tanto, en "Advanced" de cada Proxy Host de NPM pon `proxy_ssl_server_name on; proxy_ssl_name $host;` (paso 3, SNI) |
| 502 en NPM (el `curl` sin SNI sí responde) | Scheme en `http`, puerto distinto de 8443 o `127.0.0.1` como destino. Revisa la tabla del paso 3. `curl -kI https://<IP del servidor>:8443 -H 'Host: panel.<dominio>'` desde el host de NPM debe responder |
| Bucle de redirecciones en el panel o la API | El Proxy Host va en `http` al 8080: cámbialo a `https` y 8443 |
| El suspendido no ve `/corte` | El dst-nat apunta a NPM o al 80. Debe ir a `<IP de Argos>:8080` (paso 4) |
| "el puerto TCP 80 ya está en uso" al instalar | Faltan `ARGOSISP_HTTP_PORT=8080 ARGOSISP_HTTPS_PORT=8443` en el comando |

## Cómo se prueba

`infra/ci/probar-detras-de-proxy.sh` (en CI, junto a las pruebas del proxy) levanta el Caddyfile de producción con una pata en una red de "NPM" de confianza y otra en una red cualquiera, delante de un eco que aplica la misma regla que la API (`apps/api/app/portal/ip_origen.ts`). La prueba comprueba lo siguiente:

- Desde NPM la API ve la IP de `X-Forwarded-For`, de `X-Real-IP` o una IPv6, en los tres dominios, en el webhook y en `/corte`, y por TLS sin SNI.
- TLS sin SNI de verdad (node manda el `Host` como SNI si no se le quita; hasta la 1.4.0 la prueba lo mandaba y por eso no vio el fallo), a la IP del contenedor y al puerto publicado en `127.0.0.1`, como entra NPM en producción: Caddy entrega el certificado de `DOMINIO_API` y cada dominio llega a su servicio por el `Host`.
- Un `X-Forwarded-For` falso que el cliente le mandó a NPM se ignora.
- Desde otra red, la API ve el socket aunque la petición traiga encabezados.
- Sin la variable, nada cambia.

`infra/ci/probar-red-compose.sh` comprueba que `PORTAL_PROXIES_CONFIABLES` sigue a `COMPOSE_SUBNET_V4`/`V6` (compose resuelto y, con sockets, un Caddy en `10.255.252.0/26` delante de la regla de la API). La instalación completa sin la variable, y con `COMPOSE_SUBNET_V4` distinta, la sigue probando el job `distribucion` (`infra/ci/probar-distribucion.sh`).
