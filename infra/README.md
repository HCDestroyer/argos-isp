# infra

| Ruta                     | Qué es                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docker-compose.yml`     | Stack completo: postgres, redis, mailpit, migrate, api, procesos de fondo (relay, billing-worker, sesiones-worker, worker), web, portal y, con el perfil `lab`, freeradius, aaa y coa |
| `.env.example`           | Variables del compose; cópialo a `infra/.env`                                                                                                                                         |
| `mikrotik/`              | `lab.rsc` y su README: RouterOS del laboratorio (PPPoE, RADIUS, corte IPv4/IPv6, WireGuard)                                                                                           |
| `docker/daemon.lab.json` | Configuración del daemon de Docker para el servidor del laboratorio (IP real del cliente por IPv6)                                                                                    |
| `ci/`                    | Verificaciones de CI de infraestructura (FreeRADIUS)                                                                                                                                  |
| `postgres/`              | Inicialización de Postgres: base de pruebas (`init.sql`) y usuarios dueño y aplicación (`usuarios.sh`)                                                                                |

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

Cuatro servicios corren con la imagen de api (`argosisp/api`), sin puerto HTTP, cada uno con un solo comando de ace. Comparten el entorno de la API (`x-api-env`) y arrancan después de `migrate` (migraciones terminadas) con Postgres y Redis sanos.

| Servicio          | Comando                    | Dueño | Qué hace                                                                                                                                                                                                    |
| ----------------- | -------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `relay`           | `node ace eventos:relay`   | A1    | Lee `audit.outbox` sin publicar y lo publica al stream de Redis `argos:eventos`; marca `publicado_en`. Una sola instancia activa (lock en Redis). Contrato en `.claude/integration/contratos/eventos.md`    |
| `billing-worker`  | `node ace billing:worker`  | A3    | Consumidor del grupo `billing` (`pago.registrado`, `servicio.creado`) y crons de facturación: generar facturas por periodo, vencerlas y evaluar el corte                                                    |
| `sesiones-worker` | `node ace sesiones:worker` | A2    | Procesa la cola de accounting que llena `aaa` (Start, Interim-Update, Stop): escribe `network.sesiones` y emite `sesion.iniciada` / `sesion.terminada`                                                      |
| `worker`          | `node ace notify:worker`   | A6    | Consumidor del grupo `notify`, cola de envíos (correo, Telegram), cron de recordatorios de pago y cron mensual de particiones de `audit` (ver `apps/api/app/notify/README.md`). Depende además de `mailpit` |

- **Healthcheck por proceso vivo.** El contenedor ejecuta el comando con `exec`, así que el PID 1 es el propio proceso de ace; el healthcheck comprueba que `/proc/1/cmdline` sigue siendo ese comando. La imagen trae un `HEALTHCHECK` HTTP de la API que en estos procesos no aplica y se reemplaza.
- **Varias réplicas.** Los crons de BullMQ y el relay toman lock, así que escalar (`docker compose up -d --scale billing-worker=2`) no duplica trabajo; los consumidores de streams reparten mensajes dentro de su grupo.
- **Reinicio.** `docker compose restart relay billing-worker sesiones-worker worker`. Un evento que se estaba procesando sin `XACK` se reintenta (entrega al menos una vez; los consumidores son idempotentes).
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

## Walled garden

`walledGarden` de `mikrotik/lab.rsc` está vacío hasta la semana 2. El portal no carga nada externo: no usa fuentes, CDN ni iconos remotos, y llama a la API por su propio origen. Cuando A5 declare los dominios de la pasarela, se agregan ahí.
