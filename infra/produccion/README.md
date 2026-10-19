# infra/produccion · distribución e instalación (A6)

ArgosIsp como producto instalable (PLAN, "Distribución e instalación"): imágenes compiladas en GHCR, instalador de un comando, actualización con respaldo y reversión, versiones desde Conventional Commits. Runbooks: `docs/runbooks/instalacion.md` y `docs/runbooks/actualizacion.md`.

| Archivo | Qué es |
| --- | --- |
| `docker-compose.produccion.yml` | Compose de producción: solo imágenes publicadas (`${ARGOSISP_REGISTRO}/argosisp-*:${ARGOSISP_VERSION}`), nada publicado salvo el proxy (80/443) y FreeRADIUS (1812/1813 UDP) |
| `.env.example` | Referencia de las variables del `.env` de producción (el real lo genera `instalar.sh`); `nodo-portal.env.example`, la del `.env` de un nodo portal |
| `docker-compose.nodo-portal.yml` | Compose de un nodo portal remoto: solo `portal` y `proxy` (`instalar.sh --rol portal`) |
| `config/` | Init de Postgres sin base de pruebas, Caddyfile de producción (API, panel, portal por HTTPS y `/corte` por HTTP), `Caddyfile.nodo-portal` y `clients.conf` de FreeRADIUS sin el cliente del laboratorio |
| `instalar.sh` | Instalador para Ubuntu/Debian |
| `argosisp` | CLI del servidor: `estado`, `actualizar`, `revertir`, `respaldar`, `levantar`, `auto`, `radius-clientes`, `nodo-portal`, `logs`, `compose` |
| `systemd/` | Timer de parches automáticos (apagado por defecto) |
| `empaquetar.sh` | Arma `argosisp-<v>.tar.gz` (reproducible) con todo lo anterior + `mods-enabled` y `sites-enabled` de `services/aaa/freeradius` |

Workflows: `.github/workflows/release.yml` (release-please: versión, `CHANGELOG.md`, Release), `.github/workflows/imagenes.yml` (imágenes amd64/arm64, `estable`, paquete en la Release) y el job `distribucion` de `ci.yml` (`infra/ci/probar-distribucion.sh`: instalar → actualizar → reversión automática → revertir, sin publicar).

Versión instalada en la API: `GET /api/v1/version` (`apps/api/app/monitoreo/version.ts`): `ARGOSISP_VERSION`, `ARGOSISP_COMMIT` y `ARGOSISP_COMPILADA` de la imagen y la sección de esa versión en el `CHANGELOG.md` que la imagen trae.

## Decisiones

- **release-please** para versiones y CHANGELOG: lee Conventional Commits (los que ya usa el repo), deja la versión en una PR revisable antes de publicar (encaja con "una PR se mergea con CI en verde" de CLAUDE.md), secciones del CHANGELOG configurables en español y la Release con las mismas notas. Solo `GITHUB_TOKEN`; no agrega dependencias al workspace. semantic-release publica en cada push sin revisión y necesita plugins de npm; changesets exige un archivo por cambio.
- **Paquete en la Release** además de las imágenes: el compose monta configuración (Postgres, Caddy, FreeRADIUS) que no está en ninguna imagen. Cada versión trae la suya en `versiones/<v>/`, así revertir también vuelve a la configuración anterior. El paquete se sube al final: una versión existe para los servidores solo cuando sus seis imágenes ya están.
- **Respaldo previo sin cifrar** en `respaldos/actualizaciones/`: la reversión automática tiene que poder restaurar sin la clave privada de age (que no debe vivir en el servidor). El servidor ya tiene la base en claro; el respaldo diario sigue cifrado y con copia remota como esté configurado.
- **`backup` sin root** (uid 1000, el de `node` en las otras imágenes): lee y restaura los comprobantes. El servicio `permisos` deja `/comprobantes`, `/backups` y los clientes de FreeRADIUS a nombre de ese uid. En el compose de desarrollo corre como root (`BACKUP_USUARIO`), como antes.
- **Salud propia en vez de `up --wait`**: compose espera indefinidamente a una dependencia que se reinicia en bucle; `argosisp` vigila los contenedores mientras corre `up` y declara la falla en segundos (unhealthy, salida con error o 3 reinicios).

## API del portal (`api-portal`)

Decisión del PM (19 oct): el tráfico de los clientes (portal y página de corte) no debe frenar la API del panel.

- **Qué es:** un segundo contenedor de la **misma** imagen de la API, con las mismas variables, la misma base y el mismo Redis. Solo atiende HTTP; no corre migraciones (las corre `migrate`), workers, crons ni relay. No duplica datos: es otro proceso sobre la única fuente de verdad. El límite por IP del portal (`PORTAL_LIMITE_PETICIONES`) vive en Redis y lo comparten los dos procesos.
- **Por dónde llega:** el navegador llama a `/api/v1/portal/**` en el host del portal y Nitro lo reenvía (control de origen, `X-Canal: portal`, `X-Forwarded-For`) a `NUXT_API_BASE_INTERNAL` = `api-portal`. En el host de la API, Caddy manda `/api/v1/portal/*` a `api-portal`. El resto, a `api`, como siempre.
- **Interruptor:** `ARGOSISP_API_PORTAL=si|no` en el `.env`. `instalar.sh` escribe `si`, salvo con menos de 3 GB de RAM (`MemTotal` < 2900 MB): `no`, con un aviso. En una instalación anterior sin la variable, `argosisp actualizar` y `levantar` aplican la misma regla y la escriben en el `.env`. Con `si`, `argosisp` activa el perfil `api-portal` del compose y apunta el portal y Caddy a él (`ARGOSISP_API_PORTAL_DESTINO`); con `no`, el contenedor no se levanta (y se quita si estaba) y todo va a `api`. Para cambiarlo: editar el `.env` y `sudo argosisp levantar`. Un `docker compose` a mano sin `argosisp` usa siempre `api`.
- **CLI:** `esperar_sano`, `estado`, `actualizar` y `revertir` lo incluyen cuando está activo; `verificar_version` comprueba `/health` y la versión de `api` y de `api-portal`.
- **Pendiente:** límite por IP en Caddy. La imagen `caddy:2.10.0-alpine` no trae un módulo de rate limit y no se agregan dependencias: por ahora lo hace la API en Redis.

## Nodo portal remoto

El portal (y la página de corte) puede correr en otro VPS. El nodo **solo habla con la API central por HTTPS**: no tiene Postgres, Redis, migraciones ni workers, y no se le abre la base.

- **Crear el token** en el servidor principal: `sudo argosisp nodo-portal crear <nombre>` (se muestra una sola vez), `listar`, `revocar <nombre>`. Llaman a `/api/v1/internal/nodos-portal` desde el contenedor de la API con el token interno.
- **Instalar el nodo:** `instalar.sh --rol portal --central https://api.<dominio> --token <token> --dominio <d> --correo <c>`. La URL central y el token quedan en el `.env` del nodo (600). Sin `--version` instala la del central.
- **Camino de una petición:** navegador → Caddy del nodo → portal (Nitro) → Caddy del nodo (`:8081`, solo red interna) → `https://api.<dominio>` con `X-Argos-Nodo-Token`, la IP real del cliente en `X-Argos-Cliente-Ip` y `X-Argos-Cliente-Proto` (cookie `Secure` del portal) → `api-portal` del central. La API central solo cree esa IP con un token válido; con uno inválido o revocado responde 401 `nodo_portal_invalido` (contrato 1.0.0: `.claude/integration/contratos/nodo-portal.md`, A5). El portal del nodo confía en el `X-Forwarded-Proto` de su Caddy (`NUXT_PORTAL_PROXIES_CONFIABLES` = la red interna), y el Caddy del nodo confía en `X-Forwarded-For` solo en `:8081`. La IP real sale de `{client_ip}` con `trusted_proxies` limitado a la red interna del nodo; en el central, Caddy es el borde y no confía en ningún `X-Forwarded-For` entrante.
- **Actualizar:** primero el servidor principal y después cada nodo (`sudo argosisp actualizar` en el nodo). El nodo actualiza solo su imagen, sigue la versión de `GET /api/v1/version` del central y se niega a quedar más nuevo; `argosisp estado` avisa si no coinciden.
- **Red:** Postgres y Redis nunca se exponen a internet (en el central no publican puertos). Si el portal del nodo debe identificar a los clientes por IP, su tráfico tiene que llegar al nodo sin NAT (por la red del ISP o un túnel WireGuard hacia el MikroTik), igual que hoy al servidor principal. PgBouncer queda como recomendación solo si algún día se agregan procesos de API que se conecten a la base desde fuera del servidor principal; con el nodo por token no hace falta.
- **Variables para crecer:** los destinos del portal y de `api-portal` salen del `.env` (`PORTAL_API_URL_INTERNA`, `API_PORTAL_UPSTREAM`, `API_PORTAL_DB_*`, `API_PORTAL_REDIS_*`; por defecto, los del compose local) y no de nombres fijos.
