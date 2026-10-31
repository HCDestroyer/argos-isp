# Runbook · Instalar ArgosIsp en un servidor

Para el operador que instala ArgosIsp desde cero. El servidor solo descarga: las imágenes vienen compiladas de GitHub Container Registry y nunca necesita Node, pnpm ni el código fuente. Actualizar y revertir: `docs/runbooks/actualizacion.md`.

## Requisitos

| Qué | Mínimo |
| --- | --- |
| Sistema | Ubuntu 22.04/24.04 o Debian 12 (también Raspberry Pi OS de 64 bits), amd64 o arm64, con systemd |
| Memoria y disco | 2 GB de RAM (4 GB recomendados), 10 GB libres en `/opt` (más los respaldos) |
| Puertos libres | TCP 80 y 443 (panel, API, portal y `/corte`), UDP 1812 y 1813 (RADIUS) y, con WireGuard, UDP 51820 |
| DNS | `panel.<dominio>`, `api.<dominio>` y `portal.<dominio>` apuntando a la IP pública del servidor |
| Salida a internet | `github.com`, `ghcr.io`, `download.docker.com` (si falta Docker) y Let's Encrypt |

El 443 debe ser alcanzable desde internet para que Let's Encrypt emita los certificados (reto TLS-ALPN; el HTTP-01 va por el 80). Si el servidor ya tiene Nginx Proxy Manager u otro proxy en 80 y 443: `detras-de-proxy.md` (Argos en 8080/8443 y la IP real del cliente con `ARGOSISP_PROXIES_CONFIABLES`). Docker se instala solo si falta (repositorio oficial); si ya está, se exige Engine 25+ y Compose 2.24+.

## Instalar (un comando)

```sh
curl -fsSL https://github.com/HCDestroyer/argos-isp/releases/latest/download/instalar.sh | sudo bash
```

Pregunta dos cosas: el **dominio base** (`miisp.com.gt` → `panel.miisp.com.gt`, `api.…`, `portal.…`) y el **correo del administrador**. Sin preguntas:

```sh
curl -fsSL https://github.com/HCDestroyer/argos-isp/releases/latest/download/instalar.sh \
  | sudo bash -s -- --dominio miisp.com.gt --correo admin@miisp.com.gt --si
```

La instalación también pregunta si los MikroTik se conectan **por WireGuard** (abajo, «Conectar los routers por WireGuard»); sin preguntas: `--wireguard si` o `--wireguard no` (con `--si` y sin la opción, no).

Otras opciones: `--version 1.4.2` (por defecto la última del canal `estable`), `--dir /ruta` (por defecto `/opt/argosisp`). Dominios distintos del patrón: `ARGOSISP_DOMINIO_PANEL`, `ARGOSISP_DOMINIO_API`, `ARGOSISP_DOMINIO_PORTAL` en el entorno de `sudo`.

Qué hace, en orden:

1. Verifica sistema, arquitectura, RAM, disco, puertos y que no haya otra instalación (`/opt/argosisp/.env`).
2. Instala `curl`, `jq` y, si falta, Docker con el plugin de Compose.
3. Descarga el paquete de la versión (`argosisp-<v>.tar.gz` de la GitHub Release, verificado con su `.sha256`) en `/opt/argosisp/versiones/<v>/` y apunta `/opt/argosisp/actual` a él.
4. Genera **todas** las contraseñas y claves (`APP_KEY`, `AAA_PPP_KEY`, usuarios de Postgres, secret RADIUS local, tokens internos, contraseña del admin) y escribe `/opt/argosisp/.env` con permisos `600` (solo root).
5. Instala `/usr/local/bin/argosisp` y el timer de parches automáticos **apagado**.
6. Descarga las imágenes y levanta todo; espera a que cada servicio esté sano (migraciones y seed incluidos) y comprueba que la API responde con la versión instalada.
7. Muestra las URL y la clave del admin (también en `/opt/argosisp/credenciales-iniciales.txt`, 600).

## Raspberry Pi

ArgosIsp corre en un Raspberry Pi con las mismas imágenes (todas son amd64 y arm64; el CI prueba la instalación completa en arm64). Capacidad orientativa: un ISP pequeño o mediano.

- **64 bits obligatorio:** Raspberry Pi OS de 64 bits (Debian) o Ubuntu Server 24.04 arm64. Con un sistema de 32 bits (`armv7l`) el instalador se niega.
- **Nunca en la tarjeta SD.** La base de datos la desgasta en meses y un corte de luz la corrompe. Usa un SSD NVMe (Pi 5, con el HAT o la base M.2) o un SSD por USB 3 (Pi 4), y de preferencia arranca desde el SSD. Si `/opt/argosisp` o el directorio de datos de Docker (`/var/lib/docker`) quedan en una tarjeta SD (`mmcblk`), el instalador lo avisa (no bloquea).
- **Memoria:** 8 GB recomendados (Pi 5 de 8 GB). Con 4 GB funciona con margen justo: la regla de RAM solo apaga `api-portal` con menos de 3 GB (un Pi de 4 GB reporta unos 3,8 GB, así que queda encendido). Si el equipo se queda sin memoria, `ARGOSISP_API_PORTAL=no` en el `.env` y `sudo argosisp levantar` (todo va a `api`). Con 2 GB, `api-portal` queda apagado solo.
- **UPS** (o un HAT de batería) y **respaldo fuera del equipo** (`BACKUP_RCLONE_DESTINO`, o `BACKUP_HOST_DIR` en otro disco o NFS): un Pi no tiene redundancia de disco ni de fuente.
- La instalación es la misma: `curl … | sudo bash` (arriba).

## Después de instalar

1. Entra a `https://panel.<dominio>` con el correo y la clave mostrados, **cambia la clave** y borra `credenciales-iniciales.txt`. Si pierdes la clave de un administrador: `sudo argosisp admin-clave <correo>` (abajo, "Comandos").
2. **Copia `/opt/argosisp/.env` fuera del servidor** (gestor de contraseñas o bóveda). `AAA_PPP_KEY` cifra las contraseñas PPPoE y los secrets RADIUS: sin ella un respaldo no sirve.
3. Configuración → Notificaciones: SMTP y bot de Telegram (no van en el `.env`).
4. Respaldos: `BACKUP_HOST_DIR` (por defecto `/opt/argosisp/respaldos`) debería ser un disco externo o NFS; cifrado con age y copia remota con rclone en `infra/README.md`, "Respaldos". Después de editar el `.env`: `sudo argosisp levantar`.
5. RADIUS: con WireGuard no hay nada que hacer (RADIUS queda en la IP del túnel, abajo). Sin WireGuard, en `.env`, `RADIUS_BIND_IP` = la IP por la que llegan los MikroTik (la de la LAN). `COA_ORIGEN_IP` se deja **vacía**: `coa` corre en la red bridge del compose y su socket solo puede usar la IP del contenedor (con la IP del servidor, el `bind` falla); el NAT de Docker cambia el origen por la IP del servidor en la interfaz hacia el router, y esa es la que cada MikroTik debe tener en `/radius` (`radiusAddr`, `infra/mikrotik/README.md`). Da de alta los routers en el panel y genera los clientes de FreeRADIUS con `sudo argosisp radius-clientes`. Configuración del router: `infra/mikrotik/README.md`.
6. HSTS del portal: empieza en 300 s (`PORTAL_HSTS_MAX_AGE`); súbelo a `31536000` cuando el certificado del portal funcione.
7. Opcional: parches automáticos con `sudo argosisp auto activar` (`docs/runbooks/actualizacion.md`).

## Qué queda en el servidor

```
/opt/argosisp/
  .env                       configuración y secretos (600)
  actual -> versiones/1.4.2  versión en uso
  versiones/<v>/             docker-compose.yml, config/ (Postgres, Caddy, FreeRADIUS), argosisp, systemd/
  respaldos/                 respaldo diario (y respaldos/actualizaciones/, los previos a cada actualización)
  respaldos-config/          rclone.conf y, solo para restaurar un .age, age.key
  estado/                    última actualización (para `argosisp revertir`)
  registros/                 registro de cada actualización y reversión (90 días)
```

Los datos viven en volúmenes de Docker del proyecto `argosisp` (`pgdata`, `redisdata`, `comprobantes`, `caddydata`, `aaa-datos`, `radius-clientes`): no cambian entre versiones.

Servicios (`sudo argosisp estado`): `postgres`, `redis`, `backup`, `migrate` y `permisos` (una vez por arranque), `api`, `relay`, `billing-worker`, `fiscal-worker`, `sesiones-worker`, `routeros-worker`, `worker` (notificaciones), `horus-worker`, `iris-worker`, `aaa-vigia`, `web`, `portal`, `api-portal` (si `ARGOSISP_API_PORTAL=si`), `aaa`, `coa`, `freeradius` y `proxy` (Caddy: 80 y 443). Solo el proxy y FreeRADIUS publican puertos. Compose: `infra/produccion/docker-compose.produccion.yml`; variables: `infra/produccion/.env.example`.

## Conectar los routers por WireGuard

Para cuando los MikroTik no están en la misma red que el servidor (lo normal con un servidor en la nube). Cada router abre un túnel cifrado hacia el servidor y todo lo de ArgosIsp (RADIUS, CoA y la API REST del router) viaja por dentro. Hacia internet solo se abre **un puerto UDP**.

**Al instalar:** responde «sí» a la pregunta de WireGuard (o `--wireguard si`). El instalador:

- escribe en el `.env` `ARGOSISP_WIREGUARD=1`, la red del túnel `ARGOSISP_WG_RED=10.255.0.0/16` (el servidor es la `10.255.0.1`), el puerto `ARGOSISP_WG_PUERTO=51820` y `RADIUS_BIND_IP=10.255.0.1`: RADIUS solo escucha dentro del túnel;
- deja `net.ipv4.ip_nonlocal_bind=1` en `/etc/sysctl.d/90-argosisp-wireguard.conf`, para que RADIUS arranque aunque el túnel tarde unos segundos al reiniciar el servidor;
- levanta los servicios `wireguard` (crea la interfaz `wg-argos` en el servidor; su clave se genera una sola vez y queda en un volumen) y `wireguard-agente` (le pasa al túnel los routers que se registran).

**En el proveedor de la nube** abre **UDP 51820** (o el puerto que elegiste). Nada más: 80 y 443 ya estaban, y RADIUS no se publica.

**Si el dominio de la API pasa por Cloudflare u otro proxy HTTP,** el router no puede llegar por UDP a ese nombre: pon en el `.env` `ARGOSISP_WG_ENDPOINT=<IP pública del servidor>` y `sudo argosisp levantar`.

**Conectar un router:** en el panel, ficha del router → «Script de conexión» → descárgalo y aplícalo en el MikroTik (pasos y qué hace: `infra/mikrotik/README.md`, «Conectar un router»). En menos de un minuto el router aparece como «conectado».

**Script con «configuración de servicio»** (para un router nuevo que ArgosIsp configura completo: PPPoE, perfiles y corte): necesita los datos de tu red de clientes, que van en el `.env` como `ROUTERS_SERVICIO_*` (interfaz de internet del router, IP del router en los enlaces PPP, pool PPPoE, prefijos IPv4 e IPv6 de clientes, IPs del portal y DNS; qué va en cada una y ejemplos en `infra/produccion/.env.example`). No tienen valor por defecto: ArgosIsp no inventa rangos. El portal sale de `DOMINIO_PORTAL` y la interfaz PPPoE de la ficha del router. Mientras falten, el panel dice cuáles (y `argosisp estado` también); el script solo de conexión funciona igual. Después de llenarlas: `sudo argosisp levantar`.

**Activarlo después de instalar:** en el `.env` pon `ARGOSISP_WIREGUARD=1` y `RADIUS_BIND_IP=10.255.0.1` (la `.1` de `ARGOSISP_WG_RED`), crea el archivo de `sysctl` de arriba (`echo 'net.ipv4.ip_nonlocal_bind = 1' | sudo tee /etc/sysctl.d/90-argosisp-wireguard.conf && sudo sysctl --system`), abre el UDP en el proveedor y `sudo argosisp levantar`. Los routers que ya llegaban por la LAN siguen igual hasta que les apliques el script.

**Revisar:** `sudo argosisp estado` muestra el túnel (IP, puerto y cuántos routers) y **avisa de cualquier puerto abierto de más**: algo publicado fuera de 80/443, el UDP de WireGuard y RADIUS en la IP del túnel, o un servicio del servidor escuchando hacia fuera (SSH incluido: si lo usas, limítalo a tus IPs). Detalle técnico: `infra/wireguard/README.md`.

## API del portal (`api-portal`)

Un segundo proceso de la misma API (misma imagen, misma base, mismo Redis) que atiende solo `/api/v1/portal/**`, para que el tráfico de los clientes y la página de corte no hagan lenta la API del panel. No guarda datos propios: no hay nada que sincronizar. El instalador lo deja encendido (`ARGOSISP_API_PORTAL=si` en el `.env`), salvo con menos de 3 GB de RAM, donde lo deja apagado y avisa. Para apagarlo: `ARGOSISP_API_PORTAL=no` en `/opt/argosisp/.env` y `sudo argosisp levantar` (todo vuelve a `api`). Detalle: `infra/produccion/README.md`.

## Nodo portal (otro servidor, opcional)

Por defecto todo va en un servidor y el instalador no pregunta nada nuevo. Para llevar el portal a otro VPS:

1. En el servidor principal: `sudo argosisp nodo-portal crear <nombre>`. Copia el token: se muestra una sola vez.
2. En el VPS del nodo (con `portal.<dominio>`, o el que pongas en `ARGOSISP_DOMINIO_PORTAL`, apuntando a él):
   ```sh
   curl -fsSL https://github.com/HCDestroyer/argos-isp/releases/latest/download/instalar.sh | sudo bash -s -- \
     --rol portal --central https://api.<dominio> --token '<token>' --dominio <dominio> --correo <correo>
   ```
   Instala solo el portal y Caddy (sin Postgres, Redis ni workers), en la versión del central.
3. `sudo argosisp nodo-portal listar` y `revocar <nombre>` en el principal. Un token revocado deja al nodo sin API.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `sudo argosisp estado` | Versión instalada, última publicada, parches automáticos y estado de cada servicio |
| `sudo argosisp levantar` | Levanta la versión instalada y espera a que esté sana (después de editar el `.env`) |
| `sudo argosisp reparar-red [--si]` | Baja todo el proyecto (los datos quedan), borra la red de compose y vuelve a levantar. Para `has active endpoints` o `network … not found`: `docs/runbooks/red-compose.md` |
| `sudo argosisp logs [servicio]` | Registros en vivo |
| `sudo argosisp admin-clave <correo> [--stdin]` | Clave nueva para ese usuario del panel (si no existe, lo crea con el rol `admin`) y la muestra **una sola vez**; con `--stdin` la toma de la entrada estándar (`echo 'clave' \| sudo argosisp admin-clave …`). Cierra sus sesiones y queda en la auditoría (actor sistema, canal consola, la clave como `***`) |
| `sudo argosisp desinstalar [--borrar-datos] [--si]` | Baja todo el proyecto y quita el comando y el timer. Sin `--borrar-datos` conserva volúmenes y `/opt/argosisp` (se vuelve con `/opt/argosisp/actual/argosisp levantar`); con él borra todo, previa confirmación y respaldo final |
| `sudo argosisp respaldar` | Respaldo ahora (el mismo del diario) |
| `sudo argosisp compose …` | `docker compose` del proyecto con la versión instalada (`compose ps`, `compose exec api …`) |
| `sudo argosisp actualizar` / `revertir` / `auto …` | `docs/runbooks/actualizacion.md` |

## Problemas

| Síntoma | Qué hacer |
| --- | --- |
| "el puerto TCP 80 ya está en uso" | Otro servidor web (Apache, nginx). Si es un proxy que debe quedarse (Nginx Proxy Manager), instala detrás de él: `detras-de-proxy.md`. Si no, detenlo: el 80 lo necesita la página de corte |
| Instalaste la 1.1.0 con `curl … \| sudo bash` y la salida terminó en "arriba y sano", sin la clave ni `credenciales-iniciales.txt` | Error de esa versión: un comando del instalador leyó el resto del script de la entrada estándar (corregido en la siguiente). La instalación quedó completa: la clave inicial del admin es `SEED_ADMIN_PASSWORD` en `/opt/argosisp/.env` (`sudo grep ^SEED_ADMIN_PASSWORD= /opt/argosisp/.env`); el usuario, `SEED_ADMIN_EMAIL`. Cámbiala al entrar |
| "ArgosIsp no quedó sano" | `sudo argosisp logs migrate api`. El `.env` ya quedó escrito: corrige y corre `sudo argosisp levantar` (no reinstales: el instalador se niega si hay `.env`) |
| El navegador avisa de certificado inválido | Los registros DNS aún no apuntan al servidor o el 443 no es alcanzable desde internet. `sudo argosisp logs proxy`; Caddy reintenta solo |
| Reinstalar desde cero (borra **todos** los datos) | `sudo argosisp desinstalar --borrar-datos` (pide escribir BORRAR y ofrece un respaldo final en `/var/backups/argosisp-final-<fecha>/` con el `.env`; `--si` no pregunta nada) y después el comando de instalación. Baja todos los servicios (también `api-portal` y los huérfanos de otra versión), borra volúmenes, red y `/opt/argosisp`, y quita el comando y el timer. En la 1.1.0, `argosisp compose down -v` dejaba vivos `api-portal` y otros contenedores (y el proxy en el 80): si te pasó, `docker ps -aq --filter label=com.docker.compose.project=argosisp \| xargs -r docker rm -f` |
| Servidor sin internet | Copia el paquete (`argosisp-<v>.tar.gz`, `.sha256`) y un archivo `estable` con la versión a una carpeta, carga las imágenes con `docker load`, y corre `sudo ARGOSISP_FUENTE=/carpeta ARGOSISP_SIN_DESCARGA=1 bash instalar.sh …` |

## Cómo se prueba

El job `distribucion` del CI (`infra/ci/probar-distribucion.sh`) construye las siete imágenes del commit en amd64 y en arm64 (dos runners nativos en paralelo, `ubuntu-24.04` y `ubuntu-24.04-arm`), instala con `instalar.sh --si` por pipe (`cat instalar.sh | sudo bash -s -- …`, como `curl | bash`; comprueba que llega al resumen y escribe `credenciales-iniciales.txt`) en el runner (TLS con la CA interna de Caddy, `ARGOSISP_TLS=interno`), comprueba el `.env` en 600, el login del admin y `GET /api/v1/version` a través del proxy, `/corte` por HTTP con cualquier Host, sigue con actualizar y revertir (`actualizacion.md`), comprueba en cada versión que `/api/v1/portal/*` lo sirve `api-portal` (por su log de acceso) y al final instala un nodo portal en el mismo runner (segundo proyecto de compose, puertos 8080/8443) y comprueba que sus peticiones llegan a `api-portal` del central.

Prueba de punta a punta final (`infra/ci/e2e-final.sh <versión> [<siguiente>]`, workflow `E2E final`, a mano con `workflow_dispatch`): en un runner limpio instala una versión **publicada** (el `instalar.sh` de su Release, el paquete de la Release y las imágenes de GHCR), carga `pnpm demo:datos` por la API y recorre el humo: login, clientes, servicios, facturas del periodo, el pago de la demo (cliente al día), el portal (`quien-soy`, código por correo a un Mailpit conectado a la red del compose → `verificar` → `cuenta`) y `GET /api/v1/version`. Después actualiza a `<siguiente>` y revierte, y tras cada paso repite el humo y compara la huella de los datos (clientes, servicios, pagos y facturas pagadas). Sin `<siguiente>` actualiza a una copia local de la misma versión con el parche +1000 (`0.9.0` → `0.9.1000`: el paquete y las imágenes publicados con otra etiqueta), para probar el mecanismo antes de que exista una versión nueva.
