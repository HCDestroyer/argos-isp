# infra

| Ruta                     | Qué es                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`     | Stack completo: postgres, redis, mailpit, migrate, api, procesos de fondo (relay, billing-worker, sesiones-worker, worker), web, portal y, con el perfil `lab`, freeradius, aaa y coa |
| `.env.example`           | Variables del compose; cópialo a `infra/.env`                                                                                                                                         |
| `mikrotik/`              | `lab.rsc` y su README: RouterOS del laboratorio (PPPoE, RADIUS, corte IPv4/IPv6, WireGuard)                                                                                           |
| `docker/daemon.lab.json` | Configuración del daemon de Docker para el servidor del laboratorio (IP real del cliente por IPv6)                                                                                    |
| `ci/`                    | Verificaciones de CI de infraestructura (FreeRADIUS)                                                                                                                                  |
| `postgres/`              | Inicialización de Postgres: base de pruebas (`init.sql`) y usuarios dueño y aplicación (`usuarios.sh`)                                                                                |
| `backups/`               | Servicio `backup`: `pg_dump` y tar de comprobantes diarios con retención, cifrado (age) y copia remota (rclone) opcionales; `restaurar.sh` verificado por conteo de filas y de archivos (ver "Respaldos") |

```sh
cp infra/.env.example infra/.env        # completa los secretos
docker compose -f infra/docker-compose.yml up -d
```

## Postgres: usuarios

| Usuario                                                | Lo usa                                                               | Permisos                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `argosisp` (`POSTGRES_USER`, contraseña `DB_PASSWORD`) | Administración y base de pruebas `argosisp_test`                     | Superusuario. Ninguna app del compose lo usa                                                                                                                                                                                                                                        |
| `DB_OWNER_USER` (`argosisp_owner`)                     | `migrate` (migraciones y seed)                                       | Dueño de la base `argosisp` y de schemas, tablas, funciones y secuencias. Sin superusuario ni `CREATEROLE`                                                                                                                                                                          |
| `DB_APP_USER` (`argosisp_api`)                         | `api`, `relay`, `billing-worker`, `sesiones-worker`, `worker`, `coa` | Solo los del rol `argosisp_app` (migración `crear_rol_app`): DML en `core`, `network`, `billing`, `ledger` y `notify`; en `ledger.asientos`, `ledger.movimientos` y `audit.*` solo `SELECT` e `INSERT` (en `audit.outbox`, además `UPDATE` de `publicado_en` e `intentos`); sin DDL |

- `postgres/usuarios.sh` los crea al iniciar un volumen nuevo (después de `init.sql`), junto con el rol `argosisp_app`, y deja la base a nombre del dueño. Es idempotente: vuelve a correrlo para cambiar contraseñas.

    ```sh
    docker compose -f infra/docker-compose.yml exec postgres /docker-entrypoint-initdb.d/20-usuarios.sh
    ```

- Las migraciones dan los permisos a `argosisp_app` sobre lo que crean (`ALTER DEFAULT PRIVILEGES` del dueño). Como `audit.crear_particiones` es `SECURITY DEFINER`, el cron de particiones funciona con el usuario de la aplicación.
- **Volumen anterior a este cambio.** Las tablas son del superusuario y los usuarios nuevos no existen. Recrea el volumen (`docker compose -f infra/docker-compose.yml down -v` y `up -d`) y vuelve a cargar los datos de prueba con `pnpm demo:datos`. Todavía no hay servidores con datos reales; la importación de semana 3 ya parte de un volumen con estos usuarios.
- En producción cambia las tres contraseñas en `infra/.env` (`openssl rand -hex 24`).
- Verificado con el compose (`postgres` en un volumen nuevo): `usuarios.sh` crea los usuarios, `migrate` corre como dueño, y la API como `argosisp_api` carga `pnpm demo:datos` y el cron de particiones; `argosisp_api` recibe `permission denied` en `UPDATE audit.acciones` y en `CREATE TABLE`.

## Procesos de fondo

Estos servicios corren con la imagen de api (`argosisp/api`), sin puerto HTTP, cada uno con un solo comando de ace. Comparten el entorno de la API (`x-api-env`) y arrancan después de `migrate` (migraciones terminadas) con Postgres y Redis sanos.

| Servicio          | Comando                    | Dueño | Qué hace                                                                                                                                                                                                                                                                             |
| ----------------- | -------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `relay`           | `node ace eventos:relay`   | A1    | Lee `audit.outbox` sin publicar y lo publica al stream de Redis `argos:eventos`; marca `publicado_en`. Una sola instancia activa (lock en Redis). Contrato en `.claude/integration/contratos/eventos.md`                                                                             |
| `billing-worker`  | `node ace billing:worker`  | A3    | Consumidor del grupo `billing` (`pago.registrado`, `servicio.creado`) y crons de facturación: generar facturas por periodo, vencerlas y evaluar el corte                                                                                                                             |
| `sesiones-worker` | `node ace sesiones:worker` | A2    | Procesa la cola de accounting que llena `aaa` (Start, Interim-Update, Stop): escribe `network.sesiones` y emite `sesion.iniciada` / `sesion.terminada`                                                                                                                               |
| `routeros-worker` | `node ace routeros:worker` | A2    | Servicios sin PPPoE por la API REST de RouterOS: consume el grupo `routeros` del bus, corre los crons del reconciliador (cola `routeros-cron`: `recuperar` cada 30 s, `reconciliar` cada 15 min) y completa el prefijo delegado de las sesiones en modo `radius_pool` (cola `routeros-prefijos`). Una réplica (`deploy.replicas: 1`; los crons llevan lock). Debe alcanzar `www-ssl` de los routers. Variables `ROUTEROS_*` en `infra/.env.example` |
| `aaa-vigia`       | `node ace aaa:vigilar`     | A2    | Perfil lab. Sondea `/health` de los nodos `aaa` (`AAA_SALUD_NODOS`) y emite `aaa.caido` / `aaa.recuperado` |
| `worker`          | `node ace notify:worker`   | A6    | Consumidor del grupo `notify`, cola de envíos (correo, Telegram), cron de recordatorios de pago, cron mensual de particiones de `audit`, alertas internas al chat del equipo y vigilancia de los crons de billing (ver `apps/api/app/notify/README.md`). Depende además de `mailpit` |

- **Healthcheck por proceso vivo.** El contenedor ejecuta el comando con `exec`, así que el PID 1 es el propio proceso de ace; el healthcheck comprueba que `/proc/1/cmdline` sigue siendo ese comando. La imagen trae un `HEALTHCHECK` HTTP de la API que en estos procesos no aplica y se reemplaza.
- **Varias réplicas.** Los crons de BullMQ y el relay toman lock, así que escalar (`docker compose up -d --scale billing-worker=2`) no duplica trabajo; los consumidores de streams reparten mensajes dentro de su grupo.
- **Reinicio.** `docker compose restart relay billing-worker sesiones-worker routeros-worker worker`. Un evento que se estaba procesando sin `XACK` se reintenta (entrega al menos una vez; los consumidores son idempotentes).
- **Logs.** `docker compose logs -f relay` (JSON de pino).

## Portal: IP real del cliente

La página de corte identifica al cliente por su IP de origen (`GET /api/v1/portal/quien-soy`). La cadena es:

```
cliente suspendido ──dst-nat TCP/80 (MikroTik)──▶ PORTAL_BIND_IP:PORTAL_CORTE_PORT_HOST ──▶ portal:3001
portal (Nitro) ──/api/v1/portal/** + X-Forwarded-For──▶ api:3333
```

- El MikroTik conserva la IP de origen al hacer dst-nat.
- El portal agrega la IP de su socket al final de `X-Forwarded-For`. La API acepta esa cabecera (`PORTAL_CABECERA_IP=x-forwarded-for`) solo si la conexión viene de `PORTAL_PROXIES_CONFIABLES`, que por defecto es la subred fija de la red de compose (`COMPOSE_SUBNET_V4`/`COMPOSE_SUBNET_V6`). Si pones un proxy inverso delante del portal, agrega su IP a `PORTAL_PROXIES_CONFIABLES`.
- **Docker debe entregar al portal la IP real del cliente.** Por IPv4, los puertos publicados con las reglas DNAT de iptables la conservan. Esto deja de cumplirse cuando entra en juego `userland-proxy`: Docker lo usa por defecto en las conexiones a IPv6 del host y para loopback, y en esos casos el portal ve la IP del puente y `quien-soy` no identifica a nadie.

### Perfil lab (IPv4 + IPv6)

En el servidor del laboratorio:

1. Daemon de Docker sin `userland-proxy` y con IPv6. Copia `infra/docker/daemon.lab.json` a `/etc/docker/daemon.json` (o combínalo con el que ya tengas) y reinicia Docker con `systemctl restart docker`.
2. En `infra/.env`:
    - `COMPOSE_PROFILES=lab`
    - `COMPOSE_IPV6=true`: la red de compose recibe `COMPOSE_SUBNET_V6`.
    - `PORTAL_BIND_IP` = `portalV4` de `lab.rsc`.
    - `PORTAL_CORTE_PORT_HOST` = `portalCortePuerto` (80).
    - `PORTAL_URL_PUBLICA=http://<portalFqdn>`.
    - `PORTAL_HOSTS=<portalV4>,<portalV6>`.
3. Para publicar también por IPv6, agrega una línea `"[<portalV6>]:80:3001"` a `ports` del servicio `portal`. `PORTAL_BIND_IP` acepta una sola dirección.
4. Si el host no puede desactivar `userland-proxy`, la alternativa es correr el portal con `network_mode: host`, en un archivo override solo del laboratorio. En ese caso el portal escucha directo en el host, `NUXT_API_BASE_INTERNAL` debe apuntar a la API publicada (`http://127.0.0.1:3333`) y `PORTAL_PROXIES_CONFIABLES` debe incluir `127.0.0.1` y `::1`.

`COMPOSE_IPV6=false` es el valor por defecto porque `enable_ipv6` falla en hosts sin IPv6 en el kernel (por ejemplo, contenedores de CI).

## Respaldos

El servicio `backup` (imagen `infra/backups/Dockerfile`, `postgres:16.15-alpine` + `age` + `rclone`) hace un `pg_dump` diario de `argosisp`:

| Variable (`infra/.env`) | Por defecto        | Qué hace                                                                                                                                                      |
| ----------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BACKUP_HORA`           | `03:13`            | Hora UTC (21:13 en Guatemala). Si el contenedor estaba apagado a esa hora, respalda al volver; un fallo se reintenta cada 15 min                              |
| `BACKUP_HOST_DIR`       | `./backups/datos`  | Directorio del host (relativo a `infra/`) montado en `/backups`. En producción, un disco externo o un NFS: nunca el mismo disco que el volumen de Postgres    |
| `BACKUP_RETENCION_DIAS` | `14`               | Borra respaldos más viejos, local y remoto                                                                                                                    |
| `BACKUP_AGE_RECIPIENTS` | vacío              | Claves públicas de [age](https://age-encryption.org) separadas por espacio. Con valor, el dump queda `.dump.age`. La clave privada **no** vive en el servidor |
| `BACKUP_RCLONE_DESTINO` | vacío              | Copia remota con rclone (`s3:bucket/ruta`, `b2:...`, `sftp:...`), remoto definido en `BACKUP_CONFIG_DIR/rclone.conf`                                          |
| `BACKUP_CONFIG_DIR`     | `./backups/config` | Montado en `/config` (solo lectura): `rclone.conf` y, solo para restaurar, `age.key`                                                                          |

Cada respaldo deja `argosisp-<AAAAMMDDTHHMMSSZ>.dump[.age]`, su `.sha256` y un `.conteos` con las filas por tabla leídas del propio dump. Además, con la misma marca, `argosisp-<marca>.comprobantes.tar.gz[.age]` (los archivos de los comprobantes de depósito, ver abajo), su `.sha256` y un `.comprobantes.conteo` con la cantidad de archivos del tar. Mismo cifrado, misma copia remota y misma retención que el dump. El estado del último intento queda en `/backups/.estado` y el healthcheck del servicio falla si fue un error.

```sh
# Respaldo a mano (además del diario)
docker compose -f infra/docker-compose.yml exec backup respaldar.sh
# Clave para cifrar: generarla FUERA del servidor y guardar la privada en un gestor de secretos
age-keygen -o age.key        # imprime la pública: va a BACKUP_AGE_RECIPIENTS
```

### Comprobantes de depósito

Las fotos y PDF que suben los clientes (A3, `COMPROBANTES_DIR`) no viven en Postgres. En el compose:

- Volumen `comprobantes` (o una ruta del host con `COMPROBANTES_HOST_DIR`) montado en `/comprobantes` en `api` (los guarda y los sirve; el portal los sube y los pide por la API) y en `backup`. Ningún otro proceso los lee.
- `comprobantes-permisos` (imagen de api, como root, una vez por `up`) deja la carpeta a nombre de `node` (uid 1000, el usuario de la imagen de api) con `u=rwX,g=rX,o=`: un volumen nuevo o una ruta del host nacen de root, y una restauración trae los permisos del tar. `api` y `backup` esperan a que termine.
- `respaldar.sh` hace el tar **después** del dump: todo comprobante del dump tiene su archivo (los archivos nuevos que lleguen en medio quedan en el tar sin fila, lo cual es inofensivo). Si `COMPROBANTES_DIR` tiene valor y la carpeta no existe, el respaldo falla (volumen sin montar).
- `restaurar.sh` encuentra el tar de la misma marca junto al dump (o `--comprobantes ARCHIVO`), lo verifica siempre (sha256, descifrado, archivos del tar = su `.conteo`) y, después de restaurar la base, comprueba que cada `billing.comprobantes.archivo` está en el tar. Con `--comprobantes-dir /comprobantes` los deja en el volumen (vacío, o con `--reemplazar` lo vacía antes) y vuelve a contar.

### Restaurar

`restaurar.sh` restaura en una base **nueva** y comprueba que quedó completa: verifica el `.sha256`, descifra si es `.age`, crea la base con el dueño (`DB_OWNER_USER`) y zona UTC, corre `pg_restore --exit-on-error` (conserva dueños y permisos: los roles los crea `postgres/usuarios.sh`) y compara las filas de **cada tabla** con las del dump; cualquier diferencia termina con error y la lista de tablas. Con `--migrar` pone las migraciones al día con el código actual.

Prueba sin tocar producción (base aparte, en el mismo servidor):

```sh
docker compose -f infra/docker-compose.yml run --rm backup \
  restaurar.sh /backups/argosisp-20261016T031300Z.dump.age --base argosisp_prueba --comparar-con argosisp
```

**Desastre: entorno limpio** (servidor nuevo o volumen perdido). Copia el respaldo a `BACKUP_HOST_DIR` y la clave privada a `BACKUP_CONFIG_DIR/age.key`, y:

```sh
docker compose -f infra/docker-compose.yml up -d --wait postgres          # volumen nuevo: init.sql y usuarios.sh
docker compose -f infra/docker-compose.yml run --rm --no-deps backup \
  restaurar.sh /backups/argosisp-<marca>.dump.age --base argosisp --reemplazar --comprobantes-dir /comprobantes
docker compose -f infra/docker-compose.yml up -d --wait                   # migrate pone las migraciones al día
rm infra/backups/config/age.key
```

Redis no se respalda: las colas y streams se reconstruyen (el relay vuelve a publicar lo que quedó en `audit.outbox` sin `publicado_en`, y los crons procesan lo pendiente hasta ahora). La caché `aaa:user:*` se repuebla por evento y con el respaldo de `aaa` a la API.

**Probado (día 4):**

- Local, contra la base de pruebas con datos de toda la suite (90 tablas, 4 191 filas, particiones de `audit` incluidas): respaldo cifrado → `restaurar.sh --comparar-con` = filas iguales al dump y al origen. Con una base a la que le faltaba la última migración: restauración + `--migrar` aplicó `notify_alertas`. Una comparación contra una base distinta termina con código 1 y lista las tablas.
- Compose en entorno limpio (proyecto aparte): `pnpm demo:datos`, respaldo con el servicio `backup`, `down -v`, `up postgres`, `restaurar.sh --base argosisp --reemplazar`, `up --wait`: `migrate` "Already up to date", api, relay, billing-worker, worker y backup `healthy`, y la API devuelve los 8 clientes y 7 servicios con el login del admin restaurado.
- Retención: un respaldo con fecha de hace 20 días se borra con `BACKUP_RETENCION_DIAS=14`.
- CI: el paso "Respaldo y restauración" repite el ciclo sobre la base que dejan las pruebas.

**Probado (día 4, comprobantes):**

- Compose en entorno limpio (proyecto aparte): `comprobantes-permisos` deja `/comprobantes` a nombre de `node`; la API (usuario `node`) escribe tres archivos; respaldo cifrado con el servicio `backup` (dump + tar, `.conteo` = 3); `down -v` (sin volúmenes); `up postgres`; `restaurar.sh --base argosisp --reemplazar --comprobantes-dir /comprobantes` = 98 tablas iguales al dump y 3 archivos; `up --wait`: api y backup `healthy`, los archivos son de uid 1000 con `u=rwX,g=rX,o=`, la API los lee, escribe uno nuevo y `GET /comprobantes` responde 200.
- Local: un comprobante de la base sin archivo en el tar, un `.conteo` alterado y un destino no vacío sin `--reemplazar` terminan con código 1; la retención borra también los tar viejos.

## Proxy público y webhook de la pasarela

Perfil `publico`: Caddy con TLS delante de la API y del panel; el webhook de la pasarela pasa con el cuerpo crudo (la firma HMAC va sobre él). Configuración, puertos y prueba en `infra/proxy/README.md`. Variables de la pasarela (`PASARELA_PROVEEDOR`, `PASARELA_FALSA_SECRETO`, `PASARELA_URL_PUBLICA`) en `infra/.env.example`; la imagen de la API corre en producción, así que sin `PASARELA_PROVEEDOR` no hay pasarela (503).

## Walled garden

`walledGarden` de `mikrotik/lab.rsc` está vacío hasta la semana 2. El portal no carga nada externo: no usa fuentes, CDN ni iconos remotos, y llama a la API por su propio origen. Cuando A5 declare los dominios de la pasarela, se agregan ahí.
