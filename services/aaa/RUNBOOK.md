# Runbook técnico de `aaa`

Para quien diagnostica RADIUS con acceso a los contenedores, Redis y Postgres. Para el turno de operación (qué avisar, a quién llamar, cuándo pasar a los secrets locales del MikroTik), ver el runbook de operador de A6, [`docs/runbooks/aaa-caido.md`](../../docs/runbooks/aaa-caido.md). Este documento no repite esos pasos.

Diseño y contratos: [`README.md`](README.md). Comandos con el compose del laboratorio (`COMPOSE_PROFILES=lab`): `dc` = `docker compose -f infra/docker-compose.yml`.

## Camino de una autorización

```
MikroTik → FreeRADIUS (1812) → rlm_rest POST /aaa/authorize (X-Request-Id) → aaa
    aaa: Redis aaa:user:<user_ppp> → si no está o no responde: GET /api/v1/internal/aaa/servicio
         → si tampoco: último perfil conocido (modo degradado) → si no hay: 503 → Reject
FreeRADIUS: PAP/CHAP contra control:Cleartext-Password → Access-Accept con los atributos reply:
```

Presupuesto de tiempo: el MikroTik espera 1 s por intento; `rlm_rest` corta a 0,8 s; Redis a 150 ms (`commandTimeout`); la API a 600 ms (`AAA_API_TIMEOUT_MS`).

| Respuesta de `aaa` | FreeRADIUS                    | Significa                                                                           |
| ------------------ | ----------------------------- | ----------------------------------------------------------------------------------- |
| 200                | Accept (si la clave coincide) | activo, limitado o suspendido (este con el perfil de corte)                         |
| 401                | Reject                        | retirado                                                                            |
| 404                | Reject                        | inexistente o lápida                                                                |
| 500                | Reject                        | `pass_ppp` no descifra: `AAA_PPP_KEY` distinta de la de la API                      |
| 503                | Reject                        | Redis y API sin respuesta y sin último perfil conocido (o `AAA_DEGRADADO=rechazar`) |

## Métricas (`GET /metrics`, puerto 3100)

Con `METRICS_TOKEN` exige `Authorization: Bearer <token>`.

| Métrica                                                  | Qué mirar                                                                                                                                                                                                                  |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `argosisp_aaa_autorizaciones_total{resultado}`           | `accept`, `reject` (retirado), `notfound` (inexistente), `error` (500/503). Un salto de `notfound` tras un cambio suele ser `API_INTERNAL_URL` sin `/api/v1/`; uno de `error`, Redis y API caídos o `AAA_PPP_KEY` distinta |
| `argosisp_aaa_autorizacion_duracion_segundos{resultado}` | p95: `histogram_quantile(0.95, sum by (le) (rate(argosisp_aaa_autorizacion_duracion_segundos_bucket[5m])))`. Objetivo < 100 ms; > 0,8 s = FreeRADIUS ya cortó                                                              |
| `argosisp_aaa_accounting_total{tipo,resultado}`          | `error` = no se pudo encolar (Redis): el NAS reintenta; `descartado` = paquete inservible                                                                                                                                  |
| `argosisp_aaa_redis_arriba`                              | 0 = autorizando por la API (o en modo degradado)                                                                                                                                                                           |
| `argosisp_aaa_degradado`                                 | 1 = autorizando sin Redis ni API                                                                                                                                                                                           |
| `argosisp_aaa_degradado_total{resultado}`                | `perfil` (aceptado con el último conocido), `sin_perfil` y `desactivado` (Reject)                                                                                                                                          |
| `argosisp_aaa_ultimo_conocido_registros`                 | perfiles guardados para el modo degradado; debería acercarse al total de servicios PPPoE                                                                                                                                   |
| `argosisp_aaa_ultimo_conocido_espejo_timestamp_seconds`  | último espejo de Redis; si se atrasa más de 2 × `AAA_DEGRADADO_ESPEJO_S`, el espejo está fallando (ver log)                                                                                                                |

`GET /health` responde 200 mientras el proceso atiende, también en modo degradado; el JSON trae `redis` (`ok`/`caido`), `modo` (`normal`/`degradado`) y `ultimo_conocido`. El vigía `node ace aaa:vigilar` (API) emite `aaa.caido` si `/health` no responde durante 60 s (`AAA_CAIDO_TRAS_MS`) y `aaa.recuperado` al volver.

## Logs

Una línea JSON por evento, siempre con `request_id`:

- `X-Request-Id` que manda FreeRADIUS: `rad-` + md5(`<NAS-IP>|<Acct-Session-Id>`), o md5(`<NAS-IP>|u:<User-Name>`) si no hay sesión. Si no llega, `aaa` calcula el mismo valor.
- Es **el mismo para el authorize y todo el accounting de una sesión PPPoE**, y viaja a la API (log `petición`) y al worker de sesiones (`audit.acciones.request_id`, eventos `sesion.*`).

```
dc logs aaa | grep '"usuario":"cliente-101"'            # todo lo de un usuario
dc logs aaa | grep 'rad-3f2a…'                           # una sesión, en aaa
dc logs api sesiones-worker | grep 'rad-3f2a…'           # la misma sesión en la API y el worker
psql -c "select accion, resultado, created_at from audit.acciones where request_id = 'rad-3f2a…'"
```

| `msg`                                                                     | Nivel               | Campos útiles                                                                                                                  |
| ------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `authorize`                                                               | info                | `usuario`, `nas`, `origen` (`redis`, `api`, `fixtures`, `degradado`), `servicio_id`, `estado`, `rate_limit`, `resultado`, `ms` |
| `post-auth`                                                               | info                | Reject: `causa` (`Module-Failure-Message`: clave errónea, retirado…)                                                           |
| `Redis no respondió; se usó el respaldo`                                  | warn                | `error`                                                                                                                        |
| `registro inválido en Redis; se usa el respaldo`                          | warn                | `clave`: A1 escribió algo fuera del contrato                                                                                   |
| `authorize: pass_ppp`                                                     | error               | `AAA_PPP_KEY` distinta de la de la API                                                                                         |
| `modo degradado: inicio` / `fin`                                          | error / warn        | `error` (qué falló); al fin, `duracion_s` y `atendidas`                                                                        |
| `authorize: modo degradado, último perfil conocido`                       | warn                | `perfil_visto_en`, `perfil_edad_s`                                                                                             |
| `authorize: sin Redis ni API y sin último perfil conocido; se rechaza`    | error               | usuario que nunca vio este nodo                                                                                                |
| `último perfil conocido: espejo de Redis` / `espejo fallido`              | info / warn         | `leidos`, `invalidos`, `registros`, `ms`                                                                                       |
| `accounting` / `accounting: no se pudo encolar` / `accounting descartado` | info / error / warn | `tipo`, `sesion`                                                                                                               |

FreeRADIUS escribe en `dc logs freeradius`; para ver cada paquete y la respuesta de `rlm_rest`, cambiar temporalmente `command: [-X]` en el compose (registra contraseñas PAP: no dejarlo así).

## Verificar un usuario

1. Qué tiene Redis (sin la contraseña):

    ```
    dc exec redis redis-cli GET 'aaa:user:cliente-101' | jq 'del(.pass_ppp)'
    ```

    Lápida (`"eliminado": true`) = A1 lo dio de baja o cambió su `user_ppp`. Sin clave = la primera autorización irá a la API.

2. Qué devuelve la API (fuente de verdad, misma forma que Redis):

    ```
    curl -s -H "Authorization: Bearer $AAA_INTERNAL_TOKEN" \
      'http://localhost:3333/api/v1/internal/aaa/servicio?user_ppp=cliente-101' | jq 'del(.pass_ppp)'
    ```

3. Autenticación completa con `radtest` desde el contenedor de FreeRADIUS (cliente `localhost`, secret `RADIUS_LOCAL_SECRET`, exportado en el shell desde `infra/.env`). Hace falta la contraseña PPPoE del cliente (panel → servicio):

    ```
    dc exec freeradius radtest -t pap  cliente-101 '<clave>' 127.0.0.1 0 "$RADIUS_LOCAL_SECRET"
    dc exec freeradius radtest -t chap cliente-101 '<clave>' 127.0.0.1 0 "$RADIUS_LOCAL_SECRET"
    ```

    Esperado: `Access-Accept` con `Mikrotik-Rate-Limit`, IPv4 (`Framed-IP-Address` o `Framed-Pool`), `Framed-IPv6-Prefix` y `Delegated-IPv6-Prefix` (o los pools), `Acct-Interim-Interval = 300`; suspendido con `Mikrotik-Group = suspendido`, `Mikrotik-Address-List = suspendidos` y `Filter-Id = argos-corte.in`. Un `Access-Reject` se explica en el log `post-auth` y en la línea `authorize` del mismo `request_id`.

4. Como lo vería el router (con su NAS-IP), con `radclient`:

    ```
    dc exec freeradius sh -c "printf '%s\n' 'User-Name = \"cliente-101\", User-Password = \"<clave>\", NAS-IP-Address = 10.255.255.2, Acct-Session-Id = \"prueba\"' \
      | radclient -x 127.0.0.1:1812 auth \"\$RADIUS_LOCAL_SECRET\""
    ```

No llamar a `POST /aaa/authorize` con `curl` para diagnosticar: la respuesta trae la contraseña en claro (`control:Cleartext-Password`).

## Forzar el repoblado de Redis

`aaa` no necesita Redis lleno para autorizar (va a la API y cachea con `SET NX`, sin TTL), pero sin Redis lleno cada primera autorización cuesta una consulta a la API y el espejo del modo degradado no conoce a esos usuarios.

- **Toda la base** (tras perder Redis o restaurar Postgres): `node ace aaa:repoblar` en el contenedor de la API (A1; escribe todos los `aaa:user:*` con el SET condicionado por `version`). Mientras ese comando no esté en `main`, no hay repoblado masivo: las claves se llenan solas al autorizar.
- **Un usuario con datos viejos**: lo normal es que A1 lo corrija con el siguiente evento. Para forzarlo, borrar su clave; la siguiente autorización la vuelve a leer de la API:

    ```
    dc exec redis redis-cli DEL 'aaa:user:cliente-101'
    ```

    No borrar `aaa:user:*` en masa con Redis sano: cada nodo consultaría la API a la vez en la próxima reconexión masiva (prueba de carga: p95 ~200 ms con 200 simultáneas y Redis vacío).

- **Comprobar un router** antes y después: `pnpm aaa:verificar-router <router_id>` (ver abajo).

## Modo degradado

Detalle y decisión en [`README.md`, "Modo degradado"](README.md#modo-degradado-semana-3-piloto). En resumen:

- **Cuándo**: Redis no responde o no tiene la clave, **y** la API falla o no responde en 600 ms. Si Redis tiene la clave, se autoriza normal aunque la API esté caída; si la API responde, se autoriza normal aunque Redis esté caído.
- **Qué hace**: responde con el último perfil conocido del usuario: el mismo estado y atributos que la última vez. Un suspendido sigue en corte; un retirado o una lápida siguen rechazados; la contraseña se sigue verificando. Sin perfil conocido → Reject.
- **De dónde sale el perfil**: lo visto al autorizar, el espejo de `aaa:user:*` cada 300 s y el archivo `/var/lib/argosisp-aaa/ultimo-conocido.json` (se carga al arrancar; `pass_ppp` cifrada, 0600).
- **Qué no hace**: no escribe en Redis, no decide estados ni aplica cambios hechos durante la caída (al volver, los CoA de `coa` los aplican a las sesiones vivas). Accounting no tiene modo degradado: sin Redis, 503 y el NAS reintenta.
- **Cómo se ve**: `argosisp_aaa_degradado = 1`, `/health` con `modo: degradado`, logs `modo degradado: inicio` y `fin`.
- **Desactivarlo**: `AAA_DEGRADADO=rechazar` y reiniciar `aaa` (cualquier caída doble vuelve a ser Reject).

Comprobar que está preparado, antes de necesitarlo:

```
curl -s localhost:3100/health                                   # ultimo_conocido ≈ servicios PPPoE
curl -s localhost:3100/metrics | grep ultimo_conocido           # espejo reciente
dc exec aaa ls -l /var/lib/argosisp-aaa/                        # archivo presente, 0600
```

Si `ultimo_conocido` es 0 tras unos minutos: el espejo falla (log `espejo fallido`), `AAA_DEGRADADO_ESPEJO_S=0`, o el modo está en `rechazar`.

## Antes de migrar un router (piloto)

```
pnpm aaa:verificar-router <router_id> --salida informe-router-<id>.md
```

Imprime un informe Markdown y sale con 1 si algo impide migrar: router activo en modo `radius`, `radius_secret` válido, `aaa:user:*` vigente para cada servicio PPPoE no retirado (misma `version`, `pass_ppp`, estado y plan que Postgres), contraseñas que descifran, planes con perfil en el router y `user_ppp` sin duplicados. Detalle en `apps/api/app/network/sesiones/README.md`. Después:

1. `pnpm aaa:clients` y reiniciar FreeRADIUS (lee los clientes al arrancar).
2. En el router, `/radius` con la IP de FreeRADIUS y el mismo secret; `/radius incoming accept=yes port=3799` para `coa`.
3. Probar un cliente con `radtest` (arriba) y luego una reconexión real; confirmar la sesión en `network.sesiones` (`GET /api/v1/sesiones?router_id=<id>&activa=true`).

## Problemas conocidos

| Síntoma                                        | Causa probable                                                          | Qué hacer                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| Todo `notfound`                                | `API_INTERNAL_URL` sin `/api/v1/` y Redis vacío                         | Corregir la URL (termina en `/api/v1/`)                         |
| Todo `error` con log `authorize: pass_ppp`     | `AAA_PPP_KEY` de `aaa` distinta de la de la API                         | Misma clave en ambos y reiniciar `aaa`                          |
| `Access-Reject` sin línea `authorize` en `aaa` | FreeRADIUS no reconoce al NAS (secret o IP) o no alcanza a `aaa`        | `dc logs freeradius`; `pnpm aaa:clients` y reiniciar FreeRADIUS |
| Accounting sin sesiones en `network.sesiones`  | `sesiones-worker` caído o `COLAS_PREFIJO` distinto entre `aaa` y la API | Revisar el worker y el prefijo                                  |
| p95 > 100 ms con Redis sano                    | Redis vacío (todo va a la API) o máquina saturada                       | Repoblar; prueba de carga en `README.md`                        |
