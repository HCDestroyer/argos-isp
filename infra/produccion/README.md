# infra/produccion · distribución e instalación (A6)

ArgosIsp como producto instalable (PLAN, "Distribución e instalación"): imágenes compiladas en GHCR, instalador de un comando, actualización con respaldo y reversión, versiones desde Conventional Commits. Runbooks: `docs/runbooks/instalacion.md` y `docs/runbooks/actualizacion.md`.

| Archivo | Qué es |
| --- | --- |
| `docker-compose.produccion.yml` | Compose de producción: solo imágenes publicadas (`${ARGOSISP_REGISTRO}/argosisp-*:${ARGOSISP_VERSION}`), nada publicado salvo el proxy (80/443) y FreeRADIUS (1812/1813 UDP) |
| `.env.example` | Referencia de las variables del `.env` de producción (el real lo genera `instalar.sh`) |
| `config/` | Init de Postgres sin base de pruebas, Caddyfile de producción (API, panel, portal por HTTPS y `/corte` por HTTP) y `clients.conf` de FreeRADIUS sin el cliente del laboratorio |
| `instalar.sh` | Instalador para Ubuntu/Debian |
| `argosisp` | CLI del servidor: `estado`, `actualizar`, `revertir`, `respaldar`, `levantar`, `auto`, `radius-clientes`, `logs`, `compose` |
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
