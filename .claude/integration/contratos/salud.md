# Contrato: salud y registro del sistema

Versión 1.0.0 · expone A6 (`apps/api/app/monitoreo`, rama `lider/salud-apariencia`) · lo consume el panel (`apps/web`, inicio y Configuración → Sistema).

Pedido del PM: «En el dashboard de inicio hace falta agregar la salud del server, además de los logs.»

Las dos rutas solo leen: no auditan ni emiten eventos. Se calculan al pedirlas (sin caché con TTL, regla 5). Errores en `application/problem+json` (RFC 9457) como el resto de la API.

## 1. Permisos

| Permiso | Rol base | Para qué |
| --- | --- | --- |
| `sistema.ver_salud` | `admin` | `GET /api/v1/sistema/salud` |
| `sistema.ver_registro` | `admin` | `GET /api/v1/sistema/registro` |

Sin sesión: 401 `urn:argosisp:problema:no_autenticado`. Sin el permiso: 403 `urn:argosisp:problema:prohibido`. El panel solo muestra la tarjeta o la pantalla si el usuario tiene el permiso (`pnpm verificar:permisos`).

No dependen de la empresa activa: la salud es de la instalación. `X-Empresa-Id` se acepta y se ignora.

## 2. `GET /api/v1/sistema/salud`

`operationId: sistemaSalud`, esquema `SaludSistema`.

- Todos los chequeos corren **en paralelo**, cada uno con **timeout de 1 s**. La ruta responde en menos de ~2 s aunque un componente no conteste.
- Un componente que falla o no contesta a tiempo sale `caido` (o `desconocido` si no se puede medir); la ruta **nunca responde 500 por un componente**. Si Postgres está caído, la ruta igual responde 200 con `postgres` `caido` (la autenticación necesita la base: en la práctica, con Postgres caído el panel recibe el error de login antes).

```jsonc
{
    "estado_general": "degradado",          // ok | degradado | caido
    "generado_en": "2026-11-21T15:04:05.123Z",
    "duracion_ms": 84,
    "componentes": [
        {
            "id": "postgres",                // estable, ver tabla
            "grupo": "nucleo",               // nucleo | colas | eventos | red | procesos | host
            "nombre": "Base de datos (PostgreSQL)",
            "estado": "ok",                  // ok | degradado | caido | desconocido
            "detalle": "Responde en 3 ms · 12 conexiones de 100",
            "latencia_ms": 3,                // o null si no aplica o no respondió
            "desde": null,                   // ISO 8601 o null: desde cuándo está en ese estado, si se sabe
            "metricas": { "conexiones": 12, "conexiones_max": 100 }  // números o textos; claves por componente
        }
    ]
}
```

### 2.1 `estado_general`

- `caido` si `api`, `postgres` o `redis` están `caido`.
- `degradado` si cualquier otro componente está `degradado` o `caido`.
- `ok` en otro caso. `desconocido` no baja el estado general.

### 2.2 Componentes

El orden de la lista es el de esta tabla. Los ids con `<…>` se repiten (uno por cola o por cron). El panel no debe asumir que la lista es fija: puede aparecer un componente nuevo; uno desconocido se pinta con su `nombre`, `estado` y `detalle`.

| `id` | `grupo` | Mide | `ok` / `degradado` / `caido` / `desconocido` | `metricas` |
| --- | --- | --- | --- | --- |
| `api` | nucleo | El proceso de la API | Siempre `ok` si respondió | `version`, `commit`, `uptime_s`, `node`, `memoria_rss_bytes` |
| `postgres` | nucleo | `SELECT 1` + `pg_stat_activity` | ok < 500 ms; degradado ≥ 500 ms o conexiones ≥ 80 % de `max_connections`; caido si no responde | `conexiones`, `conexiones_max` |
| `redis` | nucleo | `PING` | ok < 200 ms; degradado ≥ 200 ms; caido si no responde | — |
| `cola.<nombre>` | colas | BullMQ: `notify-envios`, `notify-cron`, `billing-cron`, `aaa-accounting`, `routeros-cron`, `routeros-prefijos` | degradado si `fallidos_1h` ≥ 1 o `esperando` ≥ 500; caido si `fallidos_1h` ≥ 50 o `esperando` ≥ 5000; `desconocido` si Redis no responde | `esperando`, `activos`, `retrasados`, `fallidos`, `fallidos_1h` |
| `outbox` | eventos | Relay de `audit.outbox`: eventos sin publicar y antigüedad del más viejo | ok si no hay pendientes o el más viejo tiene < 60 s; degradado ≥ 60 s; caido ≥ 10 min. `desde` = `created_at` del más viejo | `sin_publicar`, `antiguedad_s` |
| `aaa` | red | Vigía de RADIUS: último `aaa.caido` / `aaa.recuperado` por nodo en el outbox | caido si todos los nodos con eventos están caídos; degradado si alguno; ok si ninguno; `desconocido` si el vigía nunca reportó. `desde` = `desde` del `aaa.caido` | `nodos`, `nodos_caidos`, `caidos` (texto: nombres) |
| `coa` | red | Último `coa.fallido` | degradado si hubo uno en los últimos 15 min; ok en otro caso. `desde` = el más reciente | `fallidos_15m`, `fallidos_24h`, `ultimo_fallo` (ISO o null) |
| `routers` | red | `network.routers_contacto` (sondeo `routeros.sondear` y accounting) de los routers activos | ok si todos los medidos responden; degradado si alguno no; caido si ninguno; `desconocido` si ninguno se mide | `total`, `en_linea`, `sin_respuesta`, `sin_medicion` |
| `cron.facturacion` | procesos | Última corrida correcta de `facturas.generar` (canal `cron`, `audit.acciones`) | degradado si la última tiene > 26 h; `desconocido` si no hay ninguna en 40 días. `desde` = última corrida | `ultima_corrida` |
| `cron.vencimiento` | procesos | `facturas.vencer_pendientes` | igual | `ultima_corrida` |
| `cron.corte` | procesos | `servicios.corte` | igual | `ultima_corrida` |
| `respaldos` | procesos | Archivo `*.dump` más reciente en `RESPALDOS_DIR` (si la API lo ve) | ok < 26 h; degradado ≥ 26 h; caido ≥ 72 h; `desconocido` si `RESPALDOS_DIR` no está configurado o no se puede leer | `ultimo` (ISO), `archivo`, `tamano_bytes` |
| `host.cpu` | host | `os.loadavg()` / núcleos, del host donde corre la API | degradado si carga 5 min / núcleos ≥ 1.5; caido ≥ 3 | `carga_1`, `carga_5`, `carga_15`, `nucleos` |
| `host.memoria` | host | `os.totalmem()` / `os.freemem()` | degradado ≥ 90 % usada; caido ≥ 97 % | `usada_bytes`, `total_bytes`, `porcentaje` |
| `host.disco` | host | `fs.statfs` del volumen de `COMPROBANTES_DIR` (datos, logos y comprobantes) | degradado si queda < 15 %; caido < 5 % | `libre_bytes`, `total_bytes`, `porcentaje_libre`, `ruta` |

Notas:

- Los recursos del host son los del contenedor de la API: en Docker, `os` ve la memoria y la carga del host y `statfs` el volumen montado.
- `detalle` es una frase corta en español sencillo para mostrar tal cual (no lleva secretos ni cadenas de conexión).
- Umbrales fijos en esta versión. Si se vuelven configurables, se agrega sin romper el esquema.

## 3. `GET /api/v1/sistema/registro`

`operationId: sistemaRegistro`, esquema `RegistroSistemaPagina` = `{ data: EntradaRegistro[], nextCursor: string | null }`.

Eventos operativos recientes, del más nuevo al más viejo, leídos de lo que ya está en la base y en Redis (nunca de archivos de log del contenedor).

### 3.1 Query

| Parámetro | Tipo | Por defecto | Notas |
| --- | --- | --- | --- |
| `nivel` | `error` \| `advertencia` \| `info` | todos | Filtra exacto |
| `origen` | ver 3.3 | todos | Filtra exacto |
| `desde` | ISO 8601 | hace 7 días | No se aceptan más de 31 días atrás (422 en `desde`) |
| `cursor` | string opaco | — | El `nextCursor` de la página anterior; uno inválido responde 422 en `cursor` |
| `limit` | 1–100 | 50 | |

### 3.2 Fila (`EntradaRegistro`)

```jsonc
{
    "id": "accion:9123",                  // estable: <fuente>:<id de la fila>
    "momento": "2026-11-21T14:59:01.000Z",
    "nivel": "error",                     // error | advertencia | info
    "origen": "api",
    "titulo": "Falló la acción «facturas.generar»",
    "detalle": "E_LIBRO_BLOQUEADO: El periodo 2026-10 está bloqueado",   // o null
    "entidad": { "tipo": "factura", "id": "812" },                       // o null; id siempre string
    "request_id": "01JD…"                // o null
}
```

### 3.3 Fuentes, `origen` y `nivel`

| Fuente (`id`) | `origen` | `nivel` | `titulo` |
| --- | --- | --- | --- |
| `audit.acciones` con `resultado = 'error'` (`accion:<id>`) | `api` (`contabilidad` si la acción es de `libro.*`, `asientos.*`, `cierres.*`, `ejercicios.*`; `red` si es `routeros.*` o `routers.*`; `radius` si es `aaa.*` o `sesiones.*`) | `advertencia` si el error es un rechazo de negocio (`E_…` de un `Problema` 4xx); `error` en otro caso | «Falló la acción «<accion>»» |
| `audit.red` con `ok = false` (`red:<id>`) | `coa` si `tipo` es `coa` o `disconnect`; `red` si `routeros` | `error` | «El router rechazó un comando» / «Falló un CoA» / «Falló un Disconnect» |
| Outbox `coa.fallido` (`evento:<id>`) | `coa` | `error` | «Falló un CoA o Disconnect» |
| Outbox `routeros.fallido` | `red` | `error` | «Falló una operación en RouterOS» |
| Outbox `aaa.caido` | `radius` | `error` | «RADIUS dejó de responder (<nodo>)» |
| Outbox `aaa.recuperado` | `radius` | `info` | «RADIUS volvió a responder (<nodo>)» |
| Outbox `libro.integridad_rota` | `contabilidad` | `error` | «Se rompió la integridad del libro» |
| Outbox `libro.proceso_bloqueado` | `contabilidad` | `advertencia` | «Un proceso se detuvo por un bloqueo del libro» |
| Jobs fallidos de BullMQ (`job:<cola>:<id>`), si Redis responde | `colas` | `error` | «Falló un trabajo en la cola <cola>» |

`origen` es uno de: `api`, `red`, `radius`, `coa`, `colas`, `contabilidad`.

- Si Redis no responde, la página sale sin los jobs (no falla).
- **Sin secretos**: `detalle` pasa por el mismo enmascarado de la auditoría (contraseñas PPPoE, tokens, secretos RADIUS y credenciales como `***`), y nunca incluye `entrada` completa ni el cuerpo de un comando. Para un comando de red se muestra la ruta o el tipo de comando y el mensaje de error del equipo, ya enmascarado.
- El cursor es opaco (base64url de `momento` + `id`). La paginación es estable aunque lleguen filas nuevas.

## 4. Errores

| Status | `type` | Cuándo |
| --- | --- | --- |
| 401 | `urn:argosisp:problema:no_autenticado` | Sin sesión |
| 403 | `urn:argosisp:problema:prohibido` | Sin `sistema.ver_salud` / `sistema.ver_registro` |
| 422 | `urn:argosisp:problema:validacion` | Query inválida (`errors[]` con `field`: `nivel`, `origen`, `desde`, `cursor`, `limit`) |

## 5. Cómo lo usa el panel

- Inicio (dashboard): tarjeta «Salud del servidor» con `estado_general` y los componentes que no están `ok`; enlace a la pantalla completa. Refresca a pedido o cada 30–60 s mientras la pestaña está visible (sin caché en el servidor: no pedirla más seguido).
- Pantalla «Registro del sistema»: tabla con filtros `nivel` y `origen`, «Cargar más» con `nextCursor`, enlace a la entidad cuando `entidad` no es null. Error con «Reintentar» si la ruta falla.
