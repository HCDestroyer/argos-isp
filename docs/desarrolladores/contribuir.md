---
orden: 90
---

# Contribuir al código

Cómo está organizado el repositorio, cómo levantar un entorno local, correr las pruebas, cómo funciona el CI y cómo se publica una versión. Las reglas del repositorio (arquitectura, auditoría, eventos, ACL, convenciones) están en [`.claude/CLAUDE.md`](../../.claude/CLAUDE.md): léelas antes de escribir código.

## El monorepo

pnpm workspaces (`apps/*`, `services/*`, `packages/*`), Node 22 LTS (`.nvmrc`) y pnpm 10 (`packageManager` del `package.json` raíz).

| Carpeta                                          | Paquete               | Qué es                                                                                                                       |
| ------------------------------------------------ | --------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| [`apps/api`](../../apps/api)                     | `@argosisp/api`       | AdonisJS 6: módulos de dominio (`app/<modulo>/actions`), API REST bajo `/api/v1`, workers y crons (BullMQ)                   |
| [`apps/web`](../../apps/web)                     | `@argosisp/web`       | Panel de administración (Nuxt 4 + Nuxt UI)                                                                                   |
| [`apps/portal`](../../apps/portal)               | `@argosisp/portal`    | Portal del cliente y página de corte (Nuxt 4)                                                                                |
| [`apps/docs`](../../apps/docs)                   | `@argosisp/docs`      | Este sitio (VitePress). El contenido vive en [`docs/`](../../docs)                                                           |
| [`services/aaa`](../../services/aaa)             | `@argosisp/aaa`       | Autorización y accounting para FreeRADIUS (`rlm_rest`), y su configuración                                                   |
| [`services/coa`](../../services/coa)             | `@argosisp/coa`       | CoA y Disconnect al router                                                                                                   |
| [`packages/contracts`](../../packages/contracts) | `@argosisp/contracts` | OpenAPI generado desde la API y los tipos y cliente TS que usan los frontends                                                |
| [`infra/`](../../infra)                          |                       | docker-compose de desarrollo, producción (instalador y CLI `argosisp`), respaldos, monitoreo, MikroTik, WireGuard, proxy, CI |
| [`scripts/`](../../scripts)                      |                       | Datos de demostración, datos de prueba de la importación, laboratorio, verificaciones                                        |
| [`.claude/`](../../.claude)                      |                       | Reglas, plan, modelo de datos y contratos entre módulos (`integration/contratos/`)                                           |

Dónde vive cada cosa dentro de la API:

| Qué                    | Dónde                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Lógica de negocio      | `apps/api/app/<modulo>/actions/<verbo_sustantivo>.ts` (una clase que extiende `DomainAction`) |
| Rutas y validadores    | `apps/api/start/routes/<modulo>.ts` y `app/<modulo>/validators.ts` (VineJS)                   |
| Permisos y roles base  | `apps/api/app/core/permisos.ts`                                                               |
| Comandos de consola    | `apps/api/commands/` (`node ace <comando>`)                                                   |
| Migraciones            | `apps/api/database/migrations/` (con `node ace make:migration`)                               |
| Pruebas de integración | `apps/api/tests/<modulo>/` (Japa, contra Postgres real)                                       |
| README de cada módulo  | `apps/api/app/<modulo>/README.md`: qué hace, qué eventos emite y consume                      |

## Entorno local

```sh
pnpm install
cp infra/.env.example infra/.env            # completa los secretos
docker compose -f infra/docker-compose.yml up -d postgres redis mailpit
```

Con eso puedes correr la API y los frontends en tu máquina (`pnpm --filter @argosisp/api dev`, `pnpm --filter @argosisp/web dev`, `pnpm --filter @argosisp/portal dev`), cada uno con su `.env` a partir de su `.env.example` (`apps/api`, `apps/web`, `apps/portal`, `services/aaa`, `services/coa`).

El stack completo en Docker (API, workers, panel, portal, migraciones):

```sh
docker compose -f infra/docker-compose.yml up -d
pnpm demo:datos                               # clientes, routers, planes y servicios de demostración, por la API
```

Puertos en `127.0.0.1`: API `3333`, panel `3000`, portal `3001`, Postgres `5432`, Redis `6379`, Mailpit `1025` (SMTP) y `8025` (bandeja web: ahí llegan los correos de prueba).

Perfiles del compose (`COMPOSE_PROFILES`):

| Perfil      | Agrega                                                                                                                                           |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lab`       | FreeRADIUS, `aaa`, `coa` y el vigía de RADIUS, para probar con un MikroTik ([MikroTik](../runbooks/mikrotik.md), [Laboratorio](../laboratorio/)) |
| `wireguard` | Servidor WireGuard y su agente                                                                                                                   |
| `publico`   | Proxy Caddy                                                                                                                                      |
| `monitoreo` | Prometheus y Alertmanager ([Monitoreo](../runbooks/monitoreo.md))                                                                                |

Detalle de cada servicio, usuarios de Postgres y procesos de fondo: [`infra/README.md`](../../infra/README.md).

## Comandos de `pnpm`

Desde la raíz:

| Comando                                                    | Qué hace                                                                          |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `pnpm lint`                                                | ESLint en todos los paquetes                                                      |
| `pnpm typecheck`                                           | TypeScript en todos los paquetes                                                  |
| `pnpm test`                                                | Pruebas de todos los paquetes                                                     |
| `pnpm build`                                               | Compila todos los paquetes (incluido este sitio)                                  |
| `pnpm format`                                              | Prettier sobre todo el repositorio                                                |
| `pnpm contracts:build`                                     | Genera el OpenAPI desde los validadores de la API y regenera `packages/contracts` |
| `pnpm verificar:permisos`                                  | Falla si una ruta o menú del frontend pide un permiso que no existe en el ACL     |
| `pnpm demo:datos`                                          | Carga datos de demostración por la API                                            |
| `pnpm importar`, `pnpm importar:plantillas`                | Importador ([runbook](../runbooks/importacion.md))                                |
| `pnpm emergencia:secrets-ppp`, `pnpm aaa:verificar-router` | Herramientas de operación de RADIUS ([RADIUS caído](../runbooks/aaa-caido.md))    |
| `pnpm aaa:carga`                                           | Prueba de carga de RADIUS                                                         |

Por paquete, con `pnpm --filter <paquete> <script>`: `dev`, `build`, `test`, `lint`, `typecheck`; el panel y el portal tienen además `test:e2e` (Playwright).

## Pruebas

- **API** (`apps/api`, Japa): pruebas de integración contra Postgres y Redis reales. Por defecto usan la base `argosisp_test` (`apps/api/.env.test`), que crea `infra/postgres/init.sql`. Si trabajas en paralelo con otras personas o agentes, usa una base, un puerto y prefijos de Redis propios para no borrarse las tablas entre sí:

    ```sh
    DB_DATABASE=argosisp_test_tuyo PORT=3499 COLAS_PREFIJO=tuyo AAA_REDIS_PREFIJO=tuyo:aaa:user: \
      pnpm --filter @argosisp/api test
    ```

- **Panel y portal:** Vitest (`pnpm --filter @argosisp/web test`) y Playwright (`test:e2e`), en escritorio y teléfono.
- **aaa y coa:** `node --test` (`pnpm --filter @argosisp/aaa test`).
- **Scripts de MikroTik:** `node infra/mikrotik/armar.mjs --verificar` y `node --test infra/mikrotik/render.test.mjs`.

Una tarea está terminada solo con sus pruebas de integración en verde en CI, el OpenAPI regenerado, auditoría y eventos, lint y typecheck, y el README del módulo al día (`.claude/CLAUDE.md`, «Definition of Done»).

## Archivos que no se editan a mano

- `packages/contracts/*`: `pnpm contracts:build`. El CI falla si el resultado no está commiteado.
- `pnpm-lock.yaml`: `pnpm install`.
- `infra/mikrotik/lab.rsc` y `infra/mikrotik/plantillas/*`: se arman desde `infra/mikrotik/piezas/` con `node infra/mikrotik/armar.mjs`.
- Migraciones: con `node ace make:migration`, para que lleven la marca de tiempo real.

## CI

`.github/workflows/ci.yml`, en cada push y PR:

| Job                               | Qué comprueba                                                                                                                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verificar`                       | Instalar, `pnpm lint`, `pnpm typecheck`, `pnpm verificar:permisos`, `pnpm test` (con Postgres, Redis y Mailpit como servicios), respaldo y restauración, `pnpm build` y `pnpm contracts:build` sin cambios pendientes |
| `infra`                           | `docker compose config`, la red de compose, plantillas de RouterOS, WireGuard, `radiusd -XC`, reglas de Prometheus y Alertmanager, alertas de punta a punta, proxys                                                   |
| `ensayo-restauracion`             | `infra/backups/ensayo.sh --demo`: respaldar, restaurar en un entorno limpio y levantar la API                                                                                                                         |
| `distribucion`                    | Construye las imágenes, instala con `instalar.sh`, actualiza, prueba una reversión automática y revierte, en amd64 y arm64                                                                                            |
| `e2e-panel-proyecto`, `e2e-panel` | Playwright del panel, escritorio y teléfono                                                                                                                                                                           |

Otros workflows: `docs.yml` (publica este sitio en GitHub Pages), `release.yml` (release-please), `imagenes.yml` (imágenes de cada versión) y `e2e-final.yml` (prueba de punta a punta de una versión publicada, a mano).

Una PR se mergea solo con CI en verde contra el `main` actual. Para traer `main` a tu rama: `scripts/integrar.sh <rama>` (mezcla, regenera lo generado y verifica).

## Este sitio de documentación

```sh
pnpm --filter @argosisp/docs dev       # http://localhost:3100
pnpm --filter @argosisp/docs build     # lo mismo que corre el CI
```

::: tip
El servidor de desarrollo usa el puerto 3100, el mismo que publica `aaa` en el compose con el perfil `lab`. Si los dos corren a la vez, pasa otro puerto: `pnpm --filter @argosisp/docs exec vitepress dev --port 3150`.
:::

- El contenido está en `docs/` (Markdown). La barra lateral sale de las carpetas: `orden:` en el frontmatter ordena las páginas.
- Las páginas del manual llevan `pantallas:` en el frontmatter con las pantallas del panel que explican; el botón «Ayuda» del panel abre esa página. Con `DOCS_AYUDA_ESTRICTA=1` la compilación falla si una pantalla no tiene página.
- Un enlace roto hace fallar la compilación. Un enlace a un archivo del repositorio fuera de `docs/` se convierte en un enlace a GitHub.
- Estructura, plantillas de página y reglas de escritura: [`.claude/integration/contratos/documentacion.md`](../../.claude/integration/contratos/documentacion.md).

## Commits y publicación

- Commits en [Conventional Commits](https://www.conventionalcommits.org/es/), con el módulo como alcance: `feat(billing): generar facturas por periodo`, `fix(notify): …`, `docs(notify): …`. Una PR por tarea, pequeña.
- **Versiones:** release-please lee los commits de `main` y mantiene una PR «chore: publicar versión X.Y.Z» con la versión y el `CHANGELOG.md` en español (`fix` → parche, `feat` → menor, `!` → mayor; `docs`, `test`, `ci`, `chore` y `refactor` no aparecen). Al mergearla se crean la etiqueta, la GitHub Release y las imágenes en GHCR, y los servidores ven la versión nueva. Pasos completos: [Actualizar y revertir](../runbooks/actualizacion.md#como-se-publica-una-version-equipo).
- Nunca secretos en el repositorio: van en el `.env` de cada app (documentados en su `.env.example`) y, en CI, en los secrets del repositorio.
- No agregues dependencias sin anotar el motivo en la PR.
