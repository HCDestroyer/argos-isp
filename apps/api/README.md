# @argosisp/api

API REST de ArgosIsp (AdonisJS 6 + Lucid + VineJS) sobre PostgreSQL 16. Puerto 3333.

## Qué hay

| Ruta | Qué es |
| --- | --- |
| `database/migrations/` | Modelo de datos base (`.claude/modelo-datos.md`): schemas `core`, `network`, `billing`, `ledger`, `notify`, `audit`; triggers del libro y de inmutabilidad; particiones mensuales de `audit`; rol `argosisp_app` |
| `database/seeders/acl_seeder.ts` | Permisos (`app/core/permisos.ts`), roles base y usuario admin de laboratorio |
| `app/shared/` | `DomainAction`, catálogo de eventos, errores RFC 9457, paginación por cursor, control de `version`, registro de rutas y generador de OpenAPI |
| `app/middleware/` | `request_id`, `auth`, `autorizar(permiso)`, `idempotencia`, `interno` |
| `app/core/` | Usuario, ACL mínimo (`/auth/login`, `/me`), validadores y schemas del núcleo |
| `app/{network,billing,ledger,portal}/` | Validadores VineJS y schemas de respuesta de cada módulo |
| `start/routes/*.ts` | Registro de rutas por módulo (validador + permiso + respuesta). Sin `handler` → 501 |

Implementado hoy: login, logout, `/me`, bitácora (`/bitacora/acciones`, `/bitacora/cambios`) y `/health`. El resto de la semana 1 está registrado (OpenAPI, permisos, validación) y responde **501 Problem** hasta que A1–A5 lo implementen (`x-implementado: false` en el OpenAPI).

## Correr

```sh
cp .env.example .env            # ajusta DB_* si hace falta
pnpm --filter @argosisp/api migrate
pnpm --filter @argosisp/api seed       # admin@argosisp.local / admin12345 (solo dev)
pnpm --filter @argosisp/api dev        # http://localhost:3333
```

Pruebas (Japa contra Postgres real; usa `.env.test`, BD `argosisp_test`; las variables del entorno tienen prioridad):

```sh
createdb argosisp_test            # una vez
pnpm --filter @argosisp/api test       # rollback completo + migraciones + seed + pruebas
pnpm --filter @argosisp/api lint
pnpm --filter @argosisp/api typecheck
```

Docker (contexto = raíz del monorepo): `docker build -f apps/api/Dockerfile -t argosisp/api .`. Con `RUN_MIGRATIONS=true` corre las migraciones al iniciar. `GET /health` → 200.

## Base de datos

- `id bigint identity`, `created_at`/`updated_at` timestamptz (UTC), `version` en entidades editables, dinero `numeric(14,2)` (en TS: `decimal.js`, en JSON: string `"150.00"`), enums como `text` + `CHECK`.
- **Libro**: cada movimiento lleva exactamente uno de `debe`/`haber` > 0; un constraint trigger diferido verifica al COMMIT que cada asiento tenga ≥ 2 movimientos y cuadre. `ledger.asientos` y `ledger.movimientos` rechazan UPDATE/DELETE/TRUNCATE.
- **Ojo**: knex/Lucid **no** rechaza `commit()` cuando falla una restricción diferida (revierte en silencio). `DomainAction` ejecuta `SET CONSTRAINTS ALL IMMEDIATE` antes de terminar; si escribes en `ledger` fuera de una acción, llama a `verificarRestriccionesDiferidas(trx)`.
- **Audit**: `audit.acciones`, `audit.cambios` y `audit.red` están particionadas por mes con partición DEFAULT; la migración crea el mes actual + 12. Un cron mensual debe llamar `SELECT audit.crear_particiones(current_date, 12)`. Son inmutables; `audit.outbox` solo admite UPDATE de `publicado_en` e `intentos`.
- **Rol `argosisp_app`** (NOLOGIN): DML en core/network/billing/ledger/notify, sin UPDATE/DELETE en `ledger.asientos`, `ledger.movimientos` ni `audit.*`. En producción la API debe conectar con un usuario miembro de ese rol, distinto del dueño que corre las migraciones:

  ```sql
  CREATE ROLE argosisp_api LOGIN PASSWORD '...' IN ROLE argosisp_app;
  ```

## Convenciones

### Acciones de dominio

Toda la lógica vive en `app/<modulo>/actions/<verbo_sustantivo>.ts`, una clase que extiende `DomainAction`:

```ts
export default class SuspenderServicio extends DomainAction<Entrada, Salida> {
    readonly nombre = 'servicios.suspender' // = permiso del ACL
    protected async handle(input: Entrada, t: Transaccion) {
        // t.trx: transacción Lucid; t.ctx: { actor, canal, requestId }
        t.fijarEntidad('servicio', input.servicioId)
        await t.registrarCambios({ tipo: 'servicio', id }, antes, despues) // audit.cambios, sensibles → ***
        await t.emit('servicio.estado_cambiado', { servicio_id: id, de, a, motivo }) // audit.outbox
        return resultado
    }
}
// en la ruta: new SuspenderServicio().execute(cuerpo, ctx.contextoAccion())
// desde otra acción: new X().execute(input, t.ctx, { trx: t.trx })  (savepoint)
```

- `audit.acciones` se escribe en la misma transacción; si la acción falla se revierte todo y el error se audita en una transacción aparte. La `entrada` se guarda con campos sensibles enmascarados.
- `t.alConfirmar(fn)`: trabajo que solo corre si el COMMIT se confirmó (invalidar Redis, avisar a workers). En acciones anidadas espera a la transacción externa; si algo se revierte, se descarta.
- Eventos: catálogo tipado en `app/shared/eventos.ts` (payload en snake_case, dinero como string). Agrega ahí cualquier evento nuevo.
- Ediciones con `version`: `actualizarConVersion(trx, tabla, id, version, cambios)` → 409 si cambió.

### Rutas y OpenAPI

Cada ruta se declara una vez en `start/routes/<modulo>.ts` con `definirRuta({ metodo, ruta, operacion, permiso, cuerpo, query, respuesta, idempotente, versionada, handler })`. De ahí salen el router y el OpenAPI. Acciones de estado explícitas (`POST /servicios/:id/suspender`), nunca PATCH.

- Errores: RFC 9457 `application/problem+json` (`type`, `title`, `status`, `detail`, `errors[]`). Lanza las clases de `app/shared/errores.ts`.
- Listas: `?cursor=&limit=` → `{ data, nextCursor }` con `paginar()` y `reglasPaginacion`.
- `Idempotency-Key`: `idempotente: true` en la ruta; la respuesta 2xx se guarda en `core.idempotency_keys` por `(clave, actor)` y se repite.
- `X-Request-Id` (o uno generado) viaja a la auditoría y vuelve en la respuesta; `X-Canal: panel|portal|ia…` fija el canal.

Si cambias un validador, una ruta o un schema, regenera y commitea los contratos:

```sh
pnpm contracts:build      # openapi:generate + openapi-typescript
```

`node ace openapi:generate --verificar` falla si `packages/contracts/openapi.json` está desactualizado.
