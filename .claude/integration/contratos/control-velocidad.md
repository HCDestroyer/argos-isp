# Contrato: control de velocidad por capas y sincronizar plan

Pedido del PM (semana 4): «se pueden sincronizar los planes si cambia la capacidad de subida, bajada, etc.» y «debe tener todos los tipos de control de ancho de banda y poder combinarse según el escenario». El caso real: el PM registró el mismo MikroTik dos veces para tener dos modos a la vez. Con este contrato, **un solo router** combina formas de control distintas según el plan y el tipo de conexión.

Reemplaza a `control_velocidad` (`simple` | `arbol_pcq`) de `contratos/velocidad.md`, que queda como **campo derivado y obsoleto**. Las fórmulas de velocidad (`rateLimitServicio`, `limitesPadrePlan`, reuso, CIR, ráfaga) y las reglas de oro de `velocidad.md` siguen igual. Dueño: A2. Pantalla: A4.

## 1. Estrategia: cuatro capas

Una **estrategia** es un objeto con cuatro capas:

```json
{
  "aplicacion": "radius_rate_limit",
  "padre": "por_plan",
  "tipo_cola": "default",
  "extras": { "rafaga": true, "prioridad": true, "garantizado": true, "excluir_fasttrack": true }
}
```

### Capa 1 · `aplicacion` (cómo se limita a cada cliente)

| Valor | Qué crea en RouterOS 7 | Tipos de conexión |
| --- | --- | --- |
| `radius_rate_limit` | `aaa` manda `Mikrotik-Rate-Limit` y RouterOS crea la cola dinámica de la sesión (`<pppoe-usuario>`) | solo `pppoe` |
| `perfil_ppp` | El rate-limit vive en el perfil PPP del plan (`/ppp/profile plan-<id>`, `rate-limit=`). `aaa` manda solo `Mikrotik-Group = plan-<id>` en activo; en limitado manda además el `Mikrotik-Rate-Limit` limitado (RADIUS tiene prioridad sobre el perfil) | solo `pppoe` |
| `cola_simple` | Cola simple estática por servicio (`argosisp-servicio-<id>`) escrita por la API. PPPoE: `target` = direcciones de la sesión y `aaa` no manda `Mikrotik-Rate-Limit` (§12) | todos |
| `pcq_plan` | Una cola simple por plan y estado (`argosisp-plan-<id>-pcq`, `argosisp-plan-<id>-pcq-limitado`) con `queue=` dos tipos PCQ (`pcq-rate` = MIR del plan). El cliente se identifica por el `target` de esa cola: IPv4 y prefijos de cada servicio (WISP) o de cada sesión abierta (PPPoE) | todos |
| `arbol_pcq` | Queue tree + mangle + address-list `argosisp-plan-<id>[-limitado]` (lo de hoy) | todos |

**Router sin RADIUS** (`modo_seguridad = 'api'`, `contratos/pppoe-local.md`): PPPoE con secrets locales. `perfil_ppp` crea además `plan-<id>-limitado` (rate-limit limitado) y el secret apunta a uno u otro según el estado; `arbol_pcq` pone `address-list = argosisp-plan-<id>[-limitado]` en esos perfiles. `radius_rate_limit` y `pcq_plan` no se admiten (regla 12).

**Ajuste al diseño del líder (RouterOS 7):** `pcq_plan` no identifica al cliente por address-list porque una cola simple no acepta una address-list como `target`, y con `packet-marks` y `target=0.0.0.0/0` la cola no distingue subida de bajada. La identificación por address-list + mangle es justamente `arbol_pcq`. Por eso `pcq_plan` usa el `target` con las direcciones (las mantiene el dispatcher, igual que el `target` de los padres de hoy).

### Capa 2 · `padre` (agregación)

| Valor | Familia colas simples (`radius_rate_limit`, `perfil_ppp`, `cola_simple`, `pcq_plan`) | Familia árbol (`arbol_pcq`) |
| --- | --- | --- |
| `ninguno` | Sin padre: cada cliente solo con su tope | Nodos del plan colgando de `global` con `max-limit=0` (el tope por cliente lo pone el PCQ) |
| `por_plan` | Cola padre `argosisp-plan-<id>` (`max-limit` y `limit-at` de §13). Solo para planes con reuso > 1 (con reuso 1 un padre nunca limita: es lo de hoy) | Nodos del plan con `max-limit` y `limit-at` de §13, colgando de `global` |
| `por_router` | Cola padre `argosisp-router` (`max-limit` de §13: lo de sus hijos acotado por la capacidad del enlace) y las colas de los clientes (o la `-pcq`) cuelgan de ella | Nodos globales `argosisp-global-<sentido>` (§13); nodos del plan con `max-limit=0` |
| `jerarquico` | router → plan → cliente: `argosisp-router`, debajo `argosisp-plan-<id>` (siempre, también con reuso 1), debajo el cliente | Lo de hoy: global → plan (con reuso) → PCQ |

- **PPPoE con padre:** `Mikrotik-Rate-Limit` **no lleva** el padre (el atributo de RouterOS 7 es `rx/tx ráfaga umbral tiempo prioridad limit-at`, sin `parent`). El padre llega por el perfil: `aaa` manda `Mikrotik-Group = plan-<id>` y ese perfil tiene `parent-queue` = el padre que corresponda (`argosisp-plan-<id>` o `argosisp-router`). Así ya funciona el reuso de hoy.
- Capacidad del router null = sin techo del enlace: permitido, con advertencia. El padre del router queda en lo que suman sus hijos (§13) o en 0 sin hijos.

### Capa 3 · `tipo_cola` (cola de las hojas)

| Valor | Hojas por cliente (`radius_rate_limit`, `perfil_ppp`, `cola_simple`) | `pcq_plan`, `arbol_pcq` |
| --- | --- | --- |
| `default` | Lo de RouterOS (`default-small`); no se escribe la propiedad | inválido |
| `sfq` | Tipo `argosisp-sfq` (`kind=sfq`) | inválido |
| `fq_codel` | Tipo `argosisp-fq-codel` (`kind=fq-codel`); **solo RouterOS 7** | inválido |
| `cake` | Tipo `argosisp-cake` (`kind=cake`); **solo RouterOS 7** | inválido |
| `pcq` | inválido (un PCQ reparte entre varios clientes; en la cola de uno solo no sirve) | obligatorio |

- `cola_simple`: `queue=<tipo>/<tipo>` en la cola del servicio.
- `radius_rate_limit` / `perfil_ppp`: `queue-type=<tipo>` en el perfil `plan-<id>` (la cola dinámica toma el tipo del perfil). Con `tipo_cola` ≠ `default` hace falta el perfil aunque no haya padre.
- Versión: se lee de `/system/resource` (`network.routers.routeros_version`, la guarda el sondeo y cada prueba de conexión). Versión conocida < 7 con `fq_codel` o `cake` → 422. Versión desconocida → advertencia, y el dispatcher la vuelve a revisar antes de escribir (si es < 7, no escribe el tipo y emite `routeros.fallido`).

### Capa 4 · `extras`

| Extra | `true` | `false` |
| --- | --- | --- |
| `rafaga` | `burst-*` del plan en la cola del cliente; en PCQ `pcq-burst-rate`, `pcq-burst-threshold`, `pcq-burst-time` | Sin ráfaga aunque el plan la defina |
| `prioridad` | `priority` del plan (1–8) en el cliente y en los padres | 8 en todo |
| `garantizado` | `limit-at` (CIR) en el cliente y en los padres | `limit-at=0` |
| `qos` | Prioridad por clases dentro del plan (`contratos/qos.md`): hojas por clase bajo el nodo del plan y mangle de clasificación. Solo `arbol_pcq` y con `excluir_fasttrack` (422 `qos_familia`, `qos_fasttrack`). **Por defecto `false`** | Árbol de siempre (una hoja PCQ por plan) |
| `excluir_fasttrack` | El reconciliador verifica que ninguna regla `fasttrack-connection` (IPv4 e IPv6) quede antes de las reglas `argosisp:top sin fasttrack` de `lab.rsc`; si no, fila `operacion = verificar_fasttrack` (`ok=false`) en `audit.red` y `routeros.fallido` | No se verifica (advertencia: con FastTrack las colas no limitan lo acelerado) |

ArgosIsp no escribe reglas de filtro (su orden lo pone la plantilla `lab.rsc`); solo verifica.

## 2. Dónde se elige y cómo se resuelve

| Dónde | Columna | Forma |
| --- | --- | --- |
| Router (por defecto) | `network.routers.estrategia_velocidad` jsonb NOT NULL | `{ "pppoe": <estrategia>, "ip_estatica": <estrategia>, "dhcp_fija": <estrategia> }`, las tres completas |
| Plan en ese router | `network.planes_routers.estrategia_velocidad` jsonb NULL | **Obsoleto desde 2026-11-05 (§11):** ya no se escribe una excepción nueva; las que existen siguen aplicándose hasta `routers.unificar_control_velocidad` |

- **Estrategia efectiva** de un servicio = la del router para su `tipo_conexion`, capa por capa sobrescrita por la del plan en ese router (y `extras` campo por campo). Función única: `estrategiaEfectiva()` en `apps/api/app/network/estrategia_velocidad.ts`; la usan la caché AAA, el dispatcher, la vista previa y la validación.
- Vista `Router`: `estrategia_velocidad` (las tres) y `routeros_version`. Vista `PlanRouter`: `estrategia_velocidad` (null o parcial) y su `version`.
- `control_velocidad` sigue saliendo en la vista, derivado: `arbol_pcq` si la estrategia de `pppoe` es `arbol_pcq`, si no `simple`. Si un código anterior escribe solo `control_velocidad` (y no coincide con la estrategia guardada), manda el campo viejo con su estrategia equivalente (§6).
- `network.sesiones.estrategia_velocidad`: copia de la estrategia del router y del plan cuando se abrió la sesión (la escribe el accounting `Start`). Una sesión vieja (null) se toma con la estrategia vigente.

## 3. Matriz de combinaciones

La valida `validarEstrategias()` y la publica `GET /api/v1/red/control-velocidad/matriz` (permiso `routers.ver`, schema `MatrizControlVelocidad`, forma propuesta por A4: `aplicaciones[] { valor, familia, tipos_conexion[], tipos_cola[], coa_en_vivo }`, `tipos_cola[] { valor, routeros_minimo }`, `padres[] { valor }`, `extras[] { valor, por_defecto }`, `reglas[] { rule, mensaje }`, `advertencias[]`, `atajos { simple, arbol_pcq }`) para que la pantalla no copie reglas. Una combinación inválida → **422** con `errors[]` (`field` = ruta de la capa, p. ej. `estrategia_velocidad.ip_estatica.aplicacion`, `rule`, `message` con el porqué). Las advertencias no bloquean: salen en la vista previa (`advertencias[]`).

| # | Regla | Error (`rule`) | Mensaje (ejemplo) |
| --- | --- | --- | --- |
| 1 | `radius_rate_limit` y `perfil_ppp` solo en `pppoe` | `aplicacion_tipo` | «perfil_ppp no aplica a ip_estatica: sin sesión PPP no hay perfil; usa cola_simple, pcq_plan o arbol_pcq» |
| 2 | ~~`cola_simple` no en `pppoe`~~ (quitada el 2026-11-05, §12: PPPoE admite colas simples) | — | — |
| 3 | `pcq_plan` y `arbol_pcq` exigen `tipo_cola = pcq`; las demás no aceptan `pcq` | `tipo_cola` | «arbol_pcq necesita PCQ: el tope de cada cliente es el pcq-rate» |
| 4 | `fq_codel` y `cake` solo con RouterOS ≥ 7 | `version` | «cake necesita RouterOS 7; este router tiene 6.49.10» |
| 5 | Todo lo que usa `por_router` o `jerarquico` en un router es de **una sola familia** | `familia_router` | «el techo del router se partiría en dos: colas simples (pppoe) y queue tree (ip_estatica)» |
| 6 | Un mismo plan, dentro de una familia, usa el mismo `padre` y los mismos `extras` en los tipos que comparten objetos del plan (en el árbol, todos; en colas simples, los que cuelgan de un padre y los `pcq_plan`) | `plan_consistente` | «PPPoE e IP estática del plan 3 comparten argosisp-plan-3: usa el mismo padre y los mismos extras» |
| 7 | Un mismo plan con `por_plan`/`jerarquico` no mezcla familias | `familia_plan` | «el reuso del plan 3 se partiría entre colas simples y queue tree» |
| 8 | Los valores existen | `enum` | «aplicacion debe ser una de …» |
| 12 | Router sin RADIUS (`modo_seguridad = 'api'`, `contratos/pppoe-local.md` §5): PPPoE solo con `perfil_ppp` (cualquier `padre`), `cola_simple` (§12) o `arbol_pcq`; ni `radius_rate_limit` (no hay `Mikrotik-Rate-Limit`) ni `pcq_plan` (sin accounting no hay direcciones de la sesión al conectar). Se revisa al cambiar la estrategia del router y la excepción PPPoE de un plan. Datos anteriores con `radius_rate_limit` o `pcq_plan` se aplican como `perfil_ppp` (`estrategiaLocal`) | `pppoe_sin_radius` | «el router no usa RADIUS: PPPoE se limita con el perfil del plan (perfil_ppp) o con el árbol (arbol_pcq), no con Mikrotik-Rate-Limit» |

| Advertencia | Cuándo |
| --- | --- |
| `sin_techo` | `por_router`/`jerarquico` con capacidad null |
| `reuso_dedicado` | `por_plan` en un plan con reuso 1 (no se crea padre) |
| `sin_padre_prioridad` | `prioridad` o `garantizado` con `padre = ninguno` (sin padre no hay a quién repartir) |
| `fasttrack` | `excluir_fasttrack = false` |
| `version_desconocida` | `fq_codel`/`cake` sin `routeros_version` |
| `fuera_del_techo` | El router tiene `por_router`/`jerarquico` y algún tipo o plan con `ninguno`/`por_plan` (ese tráfico no cuenta para el techo) |

## 4. Cambiar la estrategia

- `POST /api/v1/routers/:id/cambiar-estrategia-velocidad` (permiso **`routers.cambiar_control_velocidad`**, el de hoy; acción del mismo nombre): `{ version, estrategia_velocidad, motivo?, reconectar? }`.
- `POST /api/v1/planes/:id/routers/:router_id/estrategia-velocidad` (mismo permiso): `{ version, estrategia_velocidad: <parcial> | null, motivo?, reconectar? }`.
- `POST /api/v1/routers/:id/vista-previa-estrategia` (mismo permiso, no escribe): `{ estrategia_velocidad?, planes?: { "<plan_id>": <parcial> | null } }` → 200 `VistaPreviaEstrategia` o 422 con la matriz.
- `POST /routers/:id/cambiar-control-velocidad` y `GET /routers/:id/vista-previa-control?a=` siguen (obsoletos): `simple` y `arbol_pcq` son atajos a las estrategias de la migración (§6).
- Evento **`router.estrategia_cambiada`** por outbox: `router_id`, `plan_id` (null = la del router), `de`, `a` (las estrategias completas antes y después; en un plan, la parcial), `capas[]` (`aplicacion`, `padre`, `tipo_cola`, `extras`), `reconectar`, `motivo`. Lo consumen `routeros` (ejecuta el cambio) y `aaa-cache` (reescribe `aaa:user:*` del router o del plan en el router).
- En el endpoint del plan, los `field` de los 422 son `estrategia_velocidad.<tipo>.<capa>`, igual que en el del router.

### Nunca se corta a un cliente

Orden fijo: **crear lo nuevo → mover → borrar lo viejo** (`preparar` → `lotes` → `terminar`, como el cambio de modo de hoy):

1. **preparar:** tipos de cola, padres, perfiles, árbol y mangle de la estrategia nueva, sin tocar lo anterior.
2. **lotes** (50 servicios, 2 s de pausa): estado deseado de cada servicio con la estrategia nueva. En WISP se crea la cola o la entrada de lista nueva **antes** de borrar la vieja (en el mismo paso).
3. **terminar:** borra lo que ya nadie usa.

PPPoE: un cambio de perfil, de padre o de tipo de cola **no se puede aplicar a una sesión abierta** (RouterOS no deja editar una cola dinámica ni acepta `Mikrotik-Group` en un CoA para una sesión PPP). Por eso:

- Cada sesión guarda con qué estrategia entró (`network.sesiones.estrategia_velocidad`). Una sesión **conserva lo que tenía** (su entrada de lista, su PCQ, su padre y su perfil) hasta reconectar por su cuenta: el dispatcher calcula sus objetos con la estrategia de la sesión y no borra un padre, un perfil o una rama del árbol que todavía usa. Cuando reconecta (`sesion.terminada` / `sesion.iniciada`), entra con la nueva y lo viejo se borra. **Ajuste al diseño:** se descartó guardar «la estrategia anterior» en el router: con dos cambios seguidos una sesión de antes del primero quedaba mal atribuida, y un 409 bloquearía cambios durante semanas (las sesiones PPPoE duran mucho).
- Lo que sí se puede en vivo se hace por CoA (`sesion.velocidad_solicitada`, §5): el `Mikrotik-Rate-Limit` nuevo a las sesiones con `radius_rate_limit` o `perfil_ppp`.
- `reconectar: true` (opcional, nunca por defecto): Disconnect por lotes a las sesiones PPPoE para que entren ya con la estrategia nueva (lo de hoy). La vista previa dice cuántas.

### `VistaPreviaEstrategia`

```json
{
  "router_id": 1,
  "valida": true,
  "errores": [],
  "advertencias": [{ "regla": "sin_techo", "mensaje": "..." }],
  "de": { "pppoe": {...}, "ip_estatica": {...}, "dhcp_fija": {...} },
  "a": { "pppoe": {...}, "ip_estatica": {...}, "dhcp_fija": {...} },
  "crear": [{ "ruta": "/queue/simple", "clave": "argosisp:router", "nombre": "argosisp-router" }],
  "actualizar": [],
  "borrar": [],
  "menus": [{ "ruta": "/queue/simple", "crear": 1, "actualizar": 3, "borrar": 0 }],
  "servicios": 120,
  "lotes": 3,
  "sesiones_coa": 80,
  "sesiones_conservan": 12,
  "sesiones_a_desconectar": 0,
  "orden": ["preparar", "lotes", "terminar"]
}
```

- `sesiones_coa`: sesiones que reciben el rate-limit nuevo por CoA; `sesiones_conservan`: las que siguen con lo anterior hasta reconectar; `sesiones_a_desconectar`: solo con `reconectar: true`.
- Se calcula con Postgres, sin tocar el router. Con errores, 422 (la pantalla muestra `errors[]`).
- Incluye los objetos de nivel router (§10) que cambian con la estrategia (las dos reglas de FastTrack).

## 5. Sincronizar plan

`POST /api/v1/planes/:id/sincronizar?router_id=` (permiso **`planes.sincronizar`**: `admin` y `tecnico`; acepta `Idempotency-Key`). Acción `planes.sincronizar`:

1. Reescribe `aaa:user:*` de los servicios del plan (en ese router si viene `router_id`).
2. Por cada sesión PPPoE abierta del plan cuya estrategia (la vigente cuando conectó) sea `radius_rate_limit` o `perfil_ppp` y cuyo servicio esté `activo` o `limitado`, emite **`sesion.velocidad_solicitada`** `{ sesion_id, servicio_id, nas_ip, acct_session_id, user_ppp, estado, rate_limit, motivo }`. `coa` manda un **CoA-Request** (nunca Disconnect) con `Mikrotik-Rate-Limit = rate_limit` si la sesión sigue abierta y el servicio sigue en ese `estado` (si cambió, ese cambio trae su propio CoA). En `perfil_ppp` es el mismo rate-limit del perfil: RouterOS no reasigna el perfil a una sesión viva, el CoA le pone la velocidad del perfil nuevo. Cada envío y su ACK/NAK en `audit.red`; sin ACK, `coa.fallido`. `pcq_plan` y `arbol_pcq` no necesitan CoA (cambia el PCQ o la cola del plan).
3. Reconcilia cada router (colas, padres, perfiles, árbol, PCQ) con `routeros.reconciliar`.

Respuesta 200 `SincronizacionPlan`:

```json
{
  "plan_id": 3,
  "aaa_reescritos": 42,
  "routers": [
    { "router_id": 1, "nombre": "Centro", "servicios": 42, "sesiones_actualizadas": 30, "sesiones_sin_coa": 5,
      "colas_cambiadas": 4, "errores": [] }
  ]
}
```

`errores[]` lleva lo que el router no aceptó (router caído, credenciales, regla de oro); un router con error no hace fallar a los demás.

**Automático:** `plan.velocidad_cambiada` (editar el plan o su excepción por router) ejecuta lo mismo con el actor `sistema`: el consumidor `routeros` llama a `planes.sincronizar`. Hasta ahora solo reconciliaba el router y reescribía la caché; las sesiones vivas no cambiaban hasta reconectar. Una entrega repetida del evento repite el CoA con el mismo valor (inofensivo).

## 6. Migración

Migración con `node ace make:migration`. Nada cambia en el router: los objetos que pide la estrategia migrada son exactamente los de hoy.

| `control_velocidad` hoy | `pppoe` | `ip_estatica` y `dhcp_fija` |
| --- | --- | --- |
| `simple` | `radius_rate_limit`, `por_plan`, `default`, extras todo `true` | `cola_simple`, `por_plan`, `default`, extras todo `true` |
| `arbol_pcq` | `arbol_pcq`, `jerarquico`, `pcq`, `rafaga: false` (el PCQ de hoy no tiene ráfaga), el resto `true` | igual |

`planes_routers.estrategia_velocidad` queda null. Hoy `simple` usa `radius_rate_limit` para PPPoE (la cola dinámica de `Mikrotik-Rate-Limit`) y `cola_simple` para WISP, con padre por plan solo cuando el reuso es > 1: eso es `por_plan`. Prueba: con los routers migrados, el reconciliador no escribe nada.

- Un router con `control_velocidad` escrito por código anterior (el alta con `control_velocidad`, una prueba que actualiza la columna) se lee con el atajo equivalente (`estrategiasDeFila`): nada cambia hasta que alguien cambie la estrategia.
- El atajo `POST /routers/:id/cambiar-control-velocidad` escribe también la estrategia equivalente y sigue emitiendo `router.control_cambiado` (Disconnect por lotes, como siempre).

## 7. Caché AAA (`contratos/aaa.md`)

El registro `aaa:user:*` suma:

```json
"velocidad": { "aplicacion": "radius_rate_limit", "grupo": "plan-3", "rate_limit": true, "rate_limit_limitado": true }
```

- `grupo`: `Mikrotik-Group` en activo y limitado (perfil `plan-<id>` si la estrategia lo necesita: padre, `tipo_cola` ≠ `default` o `perfil_ppp`; si no, `profile_ppp` del router o null).
- `rate_limit` / `rate_limit_limitado`: si `aaa` manda `Mikrotik-Rate-Limit` en ese estado (`false` en `perfil_ppp` activo, `cola_simple`, `pcq_plan` y `arbol_pcq`). `coa` no manda CoA de velocidad con `cola_simple`, `pcq_plan` ni `arbol_pcq` (lo aplica el dispatcher de RouterOS).
- `aaa` y `coa` usan `velocidad` si viene; si no (registro viejo), lo de hoy por `control_velocidad` y `reuso`. El suspendido no cambia.

## 8. Eventos (para `contratos/eventos.md` y el catálogo de `CLAUDE.md`)

| Evento | Emite | Payload |
| --- | --- | --- |
| `router.estrategia_cambiada` | network (`routers.cambiar_control_velocidad`) | router_id, plan_id (o null), de, a, capas[], reconectar, motivo |
| `sesion.velocidad_solicitada` | network (`planes.sincronizar`) | sesion_id, servicio_id, nas_ip, acct_session_id, user_ppp, estado, rate_limit, motivo |

## 9. Pantalla (A4)

Endpoints (todos en `packages/contracts`):

| Método y ruta | Permiso | Schema |
| --- | --- | --- |
| `GET /red/control-velocidad/matriz` | `routers.ver` | `MatrizControlVelocidad` |
| `POST /routers/:id/vista-previa-estrategia` | `routers.cambiar_control_velocidad` | `VistaPreviaEstrategia` (422 si es inválida) |
| `POST /routers/:id/cambiar-estrategia-velocidad` | `routers.cambiar_control_velocidad` | `Router` |
| `POST /planes/:id/routers/:routerId/estrategia-velocidad` | `routers.cambiar_control_velocidad` | `PlanRouter` |
| `POST /planes/:id/sincronizar?router_id=` | `planes.sincronizar` (admin, tecnico) | `SincronizacionPlan` |
| `GET /routers/:id/vista-previa-reconciliar` | `routeros.reconciliar` (admin, tecnico) | `VistaPreviaReconciliar` (lee el router) |
| `POST /routers/:id/reconciliar` («Reconciliar ahora») | `routeros.reconciliar` | `ResultadoReconciliacion` |
| `GET /routers/:id/diagnostico-corte` | `routers.ver` | `DiagnosticoCorte` |


- **Selector por capas** en el router: una columna por tipo de conexión (PPPoE, IP estática, DHCP fija) con las cuatro capas; las opciones inválidas para ese tipo se ven deshabilitadas con el porqué (de la matriz). Atajo «igual para todos».
- ~~**Excepción por plan**~~: se quita (§11). En su lugar, el aviso «N planes con excepción» con la vista previa de unificar.
- **Matriz** (`GET /red/control-velocidad/matriz`): qué combina con qué; errores 422 junto a la capa (`errors[].field`).
- **Vista previa** antes de confirmar: crear / actualizar / borrar por menú, sesiones con CoA, sesiones que conservan lo anterior hasta reconectar, advertencias, y la casilla «reconectar ahora» (muestra cuántas sesiones se desconectan; apagada por defecto).
- **Botón «Sincronizar plan»** en el plan (y por router en su implementación), con permiso `planes.sincronizar`: muestra el resumen por router (sesiones actualizadas, colas cambiadas, errores con «Reintentar»).

## 10. Objetos de nivel router: corte y FastTrack (pedido del PM)

«Las reglas se deben crear y/o sincronizar según el tipo de control que se usará». El reconciliador de cada router con API mantiene, además de los objetos por servicio y de velocidad (§1), los de nivel router. Función pura `estadoCorteRouter` en `apps/api/app/network/routeros/corte_router.ts`; los aplica `aplicarCorte` (`dispatcher.ts`).

| Objeto | Cuándo | Comentario / clave |
| --- | --- | --- |
| `/interface/list suspendidos` | siempre | `name` (comentario `argosisp: interfaces PPP suspendidas`) |
| `/ppp/profile suspendido` (copia del `default`, `rate-limit` mínimo, `address-list` e `interface-list` `suspendidos`) | siempre | `name` (comentario `argosisp: servicio suspendido`) |
| Address-list `suspendidos` (`192.0.2.255`, para que exista), `argos-portal` (IP y FQDN del portal), `argos-dns`, `argos-walled` (walled garden por FQDN: pasarela) | siempre que la configuración lo defina | `list` + `address` (comentarios de `lab.rsc`) |
| Address-list `argos-clientes` (redes del router y `ROUTERS_SERVICIO_CLIENTES_V4/V6`) | siempre que haya redes | `list` + `address` |
| Filtro IPv4 e IPv6: saltos `argosisp:top corte …` y `Filter-Id de RADIUS/CoA`; cadenas `argos-corte`, `argos-corte-in`, `argos-activo` (DNS, portal, walled garden, `tcp-reset`, `icmp-admin-prohibited`) | siempre | `comment` |
| Filtro: `argosisp:top sin fasttrack: clientes con colas (subida/bajada)` | si alguna estrategia del router tiene `excluir_fasttrack` | `comment` |
| NAT IPv4: saltos `argosisp:top corte NAT …` y cadena `argos-corte-nat` (portal y walled garden sin NAT; HTTP → `to-addresses` = IPv4 del portal) | siempre (el `dst-nat`, solo con IPv4 del portal) | `comment` |

- **Los mismos comentarios y propiedades que `infra/mikrotik/lab.rsc` y el script de conexión con `incluir=servicio`**: si el router ya tiene lo del script, el reconciliador no cambia nada; si corre primero, el script lo reemplaza por lo mismo. Solo toca objetos con esos comentarios `argosisp:`; las reglas del script que no son suyas (CoA desde aaa, DNS solo interno, WireGuard, NAT de salida) no se tocan ni se mueven.
- **Orden seguro**: crear lo nuevo → mover (`POST /rest/<menú>/move`, `numbers` + `destination`) → borrar lo que sobra. Los saltos `argosisp:top` quedan al inicio de su tabla (después de los `argosisp:top` del script y antes de FastTrack y de `accept established,related`), en el orden de `lab.rsc`; las cadenas, juntas y en orden. **Verificar en el laboratorio** el `move` por REST.
- **Configuración** (la misma del script de A1): `ROUTERS_SERVICIO_PORTAL_V4`, `_PORTAL_V6`, `_PORTAL_FQDN`, `_PORTAL_PUERTO` (80), `_WALLED_GARDEN`, `_DNS_V4`, `_DNS_V6`, `_PPP_LOCAL_V4`, `_CLIENTES_V4`, `_CLIENTES_V6`, `_SUSP_RATE_LIMIT`. Si faltan, se deducen de `PORTAL_URL_PUBLICA` (FQDN o IP del portal) y de la pasarela (`PASARELA_URL_PUBLICA`; `app.recurrente.com` con Recurrente). Una entrada sin configuración no se administra (lo que dejó el script queda). Hoy la configuración vive en el entorno: un cambio se aplica en la siguiente reconciliación (periódica o «Reconciliar ahora»); cuando exista en la base, su evento disparará la reconciliación.
- **Cuándo corre**: `router.estrategia_cambiada` (último paso del cambio), `plan.velocidad_cambiada` (sincronizar), `router.conexion_registrada` (A1, primera conexión), «Reconciliar ahora», el ciclo periódico (15 min) y al volver un router caído.
- **Versión de RouterOS**: la reconciliación lee `/system/resource` y guarda `routeros_version`.
- **Auditoría**: cada comando en `audit.red`; `routeros.reconciliar` solo deja fila en `audit.acciones` si corrigió algo o falló (excepción vigente de la regla 9).

### 10.1 · IPv4 del portal para el dst-nat (portal por FQDN)

El `dst-nat` HTTP → `/corte` (`argosisp: corte-nat HTTP a /corte`) necesita una **IPv4** en `to-addresses`. De dónde sale, en este orden (`configCorteResuelta`, `corte_router.ts`):

1. `ROUTERS_SERVICIO_PORTAL_V4` (fijada a mano; manda sobre todo lo demás). **Úsala cuando el DNS del servidor de Argos no da la IP que debe usar el router** (p. ej. resuelve a la IP interna de Docker y el router necesita la pública, o al revés).
2. La IP de `PORTAL_URL_PUBLICA`, si la URL es una IP.
3. El FQDN del portal (`ROUTERS_SERVICIO_PORTAL_FQDN` o el host de `PORTAL_URL_PUBLICA`) **resuelto a IPv4 desde la API en cada reconciliación** (`getaddrinfo`, espera máxima 3 s, primer registro A). La IP resuelta vive solo en el estado deseado de esa pasada: no se guarda en la base ni se cachea (regla 5: sin TTL). Si el DNS cambia, la siguiente reconciliación corrige el `to-addresses` y la entrada `argosisp: portal IP` de `argos-portal`.

`ROUTERS_SERVICIO_PORTAL_PUERTO` (80 por defecto) es el `to-ports`. Si el FQDN **no resuelve**: el reconciliador no escribe el `dst-nat` (la regla que haya, del script o de una pasada anterior, se conserva tal cual), emite `routeros.fallido` (`operacion: "resolver portal"`, `servicio_id: null`), deja `error_portal` en el resultado y su fila en `audit.acciones`; el chequeo de corte sale en rojo (`portal_sin_ipv4`) con el paso a seguir. Nunca un verde.

### 10.2 · Chequeo `corte` de «Probar conexión»

`diagnosticoCorte(routerId)` (`apps/api/app/network/routeros/diagnostico.ts`). Es el chequeo `corte` de `POST /routers/:id/probar-conexion` (si la API respondió; el diagnóstico completo va en `chequeos[].corte`) y también `GET /routers/:id/diagnostico-corte` (`routers.ver`). Responde una pregunta: **¿un suspendido de este router ve la página de corte?** Solo lee, salvo un `/tool/fetch` (queda en `audit.red`).

Respuesta (`DiagnosticoCorte`): `ok`, `chequeos[]` (`clave`, `ok`, `codigo`, `detalle` en lenguaje simple, `comandos[]` de RouterOS para la terminal, `reconciliar`), `problemas[]` (los chequeos en rojo, más `sin_api` / `router_no_responde`), `faltan[]` (lo que «Reconciliar ahora» crearía o movería), `portal` (`url`, `fqdn`, `ipv4`, `origen` `variable`/`url`/`dns`, `destino_nat`, `alcanzable`, `http_status`, `detalle`), `suspendidos` (`total`, `fuera_de_lista`, `ejemplos[]`) y `limites[]`.

| `clave` | Qué verifica | En rojo (`codigo`) |
| --- | --- | --- |
| `lista_suspendidos` | Existe la address-list `suspendidos` (entradas estáticas o dinámicas). **Si no hay ningún suspendido con IP en el router, que no exista no es un problema** (verde, «no hace falta») | `falta_lista_suspendidos` (hay suspendidos y no existe) |
| `reglas` | Las reglas de corte de filter (IPv4 e IPv6) y NAT están, activas, iguales a lo deseado y en orden | `faltan_reglas` (incluye el `dst-nat` HTTP si Argos no tiene la IPv4 del portal y el router tampoco la tiene), `reglas_desactivadas`, `reglas_distintas` (p. ej. el NAT apunta a otra IP), `reglas_desordenadas` |
| `portal_http` | `/tool/fetch url=http://<ip>:<puerto>/corte output=none` **al destino real del dst-nat**: el `to-addresses`/`to-ports` de la regla del router si existe y está activa; si no, el deseado. No prueba `PORTAL_URL_PUBLICA`. Un 3xx cuenta como bien (el navegador sigue la redirección) | `portal_sin_ipv4` (FQDN sin resolver), `portal_sin_configurar`, `portal_sin_corte` (responde 4xx/5xx), `portal_inalcanzable` (timeout o puerto cerrado) |
| `sesiones_suspendidas` | Cada servicio `suspendido` del router con IPv4 (PPPoE: la de su sesión abierta en `network.sesiones`; WISP: la asignada) tiene su IP en `suspendidos`. Dice cuántos faltan | `suspendidos_fuera_de_lista` (PPPoE: `/ppp active remove [find address=<ip>]` para que reconecte con el perfil suspendido; WISP: «Reconciliar ahora» o la entrada `argosisp:servicio:<id>`) |
| `fasttrack` | Si hay una regla `fasttrack-connection` activa, los saltos `argosisp:top` de forward (corte, Filter-Id y, si la estrategia lo pide, la excepción de los clientes con colas) van antes | `fasttrack` |
| `perfil_suspendido` | El perfil PPP `suspendido` pone sus sesiones en `suspendidos` | `falta_perfil_suspendido` |
| `walled_garden` | `argos-portal` (IP y FQDN) y `argos-walled` (pasarela) tienen lo configurado | `walled_garden` |

Los comandos usan la sintaxis de la terminal (`/ip firewall nat add …`, `enable [find comment="…"]`, `move [find comment="…"] destination=([find where dynamic=no]->0)`); hasta 12 por chequeo. `reconciliar: true` cuando «Reconciliar ahora» lo arregla solo.

### 10.3 · Límites del corte (el panel los muestra siempre; `limites[]`)

- **HTTPS (443) no se redirige**: no se puede redirigir TLS sin un certificado del sitio que el cliente quiso abrir. El router corta con un reset TCP (`argosisp: corte TCP reset`) y el navegador muestra «no se puede conectar». La página aparece al abrir un sitio `http://` o con la detección de portal cautivo del teléfono o la computadora (que usa HTTP).
- **IPv6 no se redirige**: no hay NAT a `/corte` en IPv6; al suspendido solo se le deja DNS, el portal y el walled garden, y el resto se rechaza. Si su equipo prefiere IPv6, la página aparece cuando el navegador cae a IPv4.
- **El portal** (A5) debe responder `/corte` por HTTP en `ROUTERS_SERVICIO_PORTAL_PUERTO` **con cualquier encabezado `Host`** (llega el del sitio que el cliente intentó abrir) y ver la **IP real del cliente** (sin NAT de origen entre el router y el portal, o con `X-Forwarded-For` de un proxy de confianza) para identificarlo por `network.sesiones`.

## 11. Modo de velocidad único por router (decisión del PM, 2026-11-05)

El modo de control de velocidad se decide **por router**: todos sus servicios siguen la misma lógica. Se quitan las excepciones por plan. Manda sobre §2, §4 y §9 donde choquen.

- **No hay excepciones nuevas.** `POST /planes/:id/routers/:routerId/estrategia-velocidad` solo acepta `estrategia_velocidad: null` (quitar la de un plan); un objeto → 422 `estrategia_por_router` (field `estrategia_velocidad`). `POST /routers/:id/vista-previa-estrategia` acepta `planes[]` solo con `estrategia_velocidad: null`; un objeto → 422 `estrategia_por_router` (field `planes.<plan_id>`). Los dos campos quedan `deprecated` en el OpenAPI y se borran cuando A4 quite la pantalla.
- **Las excepciones que existen siguen funcionando** igual (la estrategia efectiva de §2 no cambia, `estrategiaEfectiva` tampoco) hasta que alguien las unifique. Nada se migra solo.
- **Vista previa** `GET /api/v1/routers/:id/vista-previa-unificar-velocidad?reconectar=` (permiso `routers.ver`, no escribe, no lee el router) → `VistaPreviaUnificarVelocidad`:

```json
{
  "router_id": 1,
  "router_version": 7,
  "planes": [
    { "plan_id": 3, "nombre": "Fibra 50", "implementacion_id": 9, "version": 2,
      "excepcion": { "pppoe": { "aplicacion": "arbol_pcq" } },
      "capas": ["aplicacion", "tipo_cola"],
      "de": { "pppoe": {...}, "ip_estatica": {...}, "dhcp_fija": {...} },
      "a":  { "pppoe": {...}, "ip_estatica": {...}, "dhcp_fija": {...} },
      "servicios": 42, "sesiones_abiertas": 30 }
  ],
  "vista_previa": { "...": "VistaPreviaEstrategia de §4 con todas las excepciones en null" }
}
```

  `de` = estrategia efectiva hoy de ese plan; `a` = la del router. `vista_previa.sesiones_coa` / `sesiones_conservan` / `sesiones_a_desconectar` dicen cuántas sesiones reciben CoA, cuántas conservan lo anterior hasta reconectar y cuántas se desconectan con `reconectar=true`. Sin excepciones: `planes: []`.
- **Acción `routers.unificar_control_velocidad`** (permiso del mismo nombre, solo `admin`): `POST /api/v1/routers/:id/unificar-control-velocidad` `{ planes: number[], reconectar?, motivo? }`, acepta `Idempotency-Key`. `planes` = los `plan_id` que el usuario vio en la vista previa: si no coinciden con las excepciones actuales → 409 `excepciones_cambiaron` (volver a pedir la vista previa). Valida la matriz del router sin excepciones (422 como §3). En una transacción: pone `planes_routers.estrategia_velocidad = null` en cada uno (diff en `audit.cambios`, `plan_router`), emite **un `router.estrategia_cambiada` por plan** con `plan_id`, `de` = la parcial, `a: null`, `capas`, `reconectar` y `motivo: 'unificar'` (el motivo del usuario va en la auditoría), y reescribe `aaa:user:*` del router al confirmar. Respuesta `ResultadoUnificarVelocidad { router_id, planes: number[] }`. Sin excepciones y `planes: []`: 200 sin eventos.
- **RouterOS (A2):** cada evento se aplica como quitar la excepción de un plan (§4: crear → mover → borrar; las sesiones conservan lo suyo hasta reconectar, salvo `reconectar`). Con varios planes del mismo router conviene juntarlos en una sola corrida (pedido en `a1.md`).
- **Pantalla (A4):** quitar «Excepción por plan»; en «Control de velocidad» del router, si `vista-previa-unificar-velocidad` trae planes, un aviso con la lista, qué cambia y cuántas sesiones reconectan, y el botón «Unificar» (`routers.unificar_control_velocidad`).

## 12. Solo las reglas del modo activo y PPPoE con colas simples (bug del PM, 2026-11-05, v1.9.0)

«Argos está escribiendo todas las reglas sin importar el tipo de control» y «no deja permitir PPPoE con colas simples». Manda sobre §1, §3 y §10 donde choquen.

**Solo se escribe lo del modo activo.** Un router escribe los objetos de velocidad de la estrategia con la que está limitado **cada servicio que tiene** (la de su tipo de conexión, o la de su sesión PPPoE hasta reconectar, §4). La estrategia de un tipo de conexión sin servicios en el router no escribe nada:

- El perfil `plan-<id>` (y `plan-<id>-s<srv>`, `plan-<id>-limitado`) solo existe si el plan tiene servicios **PPPoE** en el router (antes lo creaba cualquier servicio WISP del plan, con `rate-limit` en `perfil_ppp`, `parent-queue` y su cola padre, junto al árbol o a la cola del servicio).
- Los nodos globales del árbol (`argosisp-global-*`) solo si un plan del árbol con servicios los usa (antes bastaba con que la estrategia de un tipo sin servicios fuera `arbol_pcq` con `por_router`/`jerarquico`).
- Lo que sobra (comment `argosisp:plan:…`, `argosisp:global:…`, `argosisp:router`, `argosisp:qos…` y los tipos `argosisp-…` por nombre) lo borra `routeros.reconciliar` (periódico, «Reconciliar ahora», cambio de estrategia, `router.conexion_registrada`) y `routeros.aplicar_servicio`: cada `DELETE` en `audit.red` y la corrida en `audit.acciones` (corrigió algo). Nunca lo ajeno ni lo adoptado (sin comment de ArgosIsp). Un padre o perfil con sesiones PPPoE colgando se conserva hasta que reconecten (§4).

**PPPoE con `cola_simple`** (decisión de A2, RouterOS 7):

| | RADIUS | Sin RADIUS (`api`) |
| --- | --- | --- |
| Cola | `/queue/simple argosisp-servicio-<id>` (comment `argosisp:servicio:<id>`), `max-limit`/ráfaga/`limit-at`/`priority` de `rateLimitServicio` en activo o limitado, `queue=<tipo>/<tipo>` y `parent` al padre del plan o del router como en WISP | igual |
| `target` | Direcciones de la sesión abierta (`network.sesiones`: IPv4/32, /64 y /56 que reportó el accounting). Sin sesión, la IPv4 fija y el delegado del servicio; sin ninguno, no hay cola | Las de la sesión del sondeo o, sin ella, la IPv4 fija (`remote-address` del secret). Con pool y sin IP fija, la cola llega con el primer sondeo (1 min) |
| `aaa` | Sin `Mikrotik-Rate-Limit` ni `Mikrotik-Group` del plan (`velocidad.rate_limit = rate_limit_limitado = false`, `grupo` = `profile_ppp` del router) | — |
| Perfil | Ninguno del plan | Un solo perfil `plan-<id>` sin `rate-limit`, `parent-queue` ni `queue-type` (el secret apunta a él en activo y en limitado) |
| Limitar / activar | La cola se reescribe por `servicio.estado_cambiado` (dispatcher); `coa` no manda nada; **sin reconectar** | igual (el secret no cambia de perfil) |
| Suspender | Sin cola estática: el perfil de corte (CoA o `Mikrotik-Group = suspendido`) pone el rate-limit mínimo | Sin cola estática: el secret pasa al perfil `suspendido` |

- **Nunca `target=<pppoe-usuario>`**: RouterOS guarda el `target` de una cola estática por el id interno de la interfaz, y la interfaz dinámica de la sesión cambia de id en cada reconexión (la cola queda inválida). Por eso el dispatcher mantiene el `target` con `sesion.iniciada` / `sesion.terminada`, igual que el de los padres y el de `pcq_plan`. **Verificar en el laboratorio.**
- `cola_simple` queda en la familia de colas simples: las reglas 5 a 7 no cambian.

## 13. Padres: nunca bajo el hijo más rápido ni sobre la suma de los hijos (bug del PM, 2026-11-05)

**Queja del PM.** «El padre tiene una velocidad mayor que la suma de todos los hijos, y si solo hay 1 hijo, ¿puede ese hijo navegar a la velocidad de su plan?». Con `max-limit = MIR × max(activos, 1) / reuso`: con reuso > 1 y pocos hijos el padre quedaba bajo un MIR (1 hijo en 1:4 → MIR/4, nunca llegaba a su plan); con 0 activos quedaba en MIR/reuso; contaba como hijos a servicios sin cola (PPPoE sin sesión) y a los limitados con la velocidad del plan, y el padre del router quedaba siempre en la capacidad del enlace.

### Regla (por sentido, kbps enteros)

Para cada hijo:
- `MIR` = su `max-limit`: el del plan en `activo`, el limitado en `limitado`.
- `pico` = la velocidad máxima que alcanza **solo**: su `burst-limit` si el plan tiene ráfaga (`rafaga_*_kbps` > MIR) y el estado la usa (`activo`; el limitado va sin ráfaga, como `rate_limit_limitado`); si no, su MIR.
- `CIR` = su `limit-at` (`garantizadoKbps` de su MIR).

```
max-limit del padre del plan = clamp( ceil(Σ MIR / reuso),  max(pico),  max(Σ MIR, max(pico)) )
limit-at del padre del plan  = Σ CIR
```

- **Piso `max(pico)`:** nunca baja de lo que alcanza el hijo más rápido. Un hijo solo navega a su plan y completa su ráfaga.
- **Techo `max(Σ MIR, max(pico))`:** nunca pasa de la suma de los MIR; la ráfaga es temporal, así que el agregado sigue en Σ MIR, salvo para no cortar la ráfaga de un hijo solo.
- **Regla de oro intacta:** `Σ limit-at ≤ max-limit` porque `CIR ≤ MIR / reuso` (`validarVelocidad`), así que `Σ CIR ≤ ceil(Σ MIR / reuso)`. Se sigue verificando contra lo que hay en el router (`limit_at_hijos`).
- **El padre no tiene ráfaga propia:** en colas simples se escribe `burst-limit=0/0`, `burst-threshold=0/0`, `burst-time=0s/0s` (si un padre existente tiene `burst-*`, la reconciliación lo pone en 0); en el árbol los nodos no llevan `burst-*` (ArgosIsp nunca los escribe). La ráfaga es del hijo y el piso la respeta.
- `rate_limit_override` del router no entra en la cuenta del padre (se usa el plan efectivo); las sesiones que lo traen sí cuentan como el router las tiene (abajo).

### Quién es hijo

Σ y `max` se hacen sobre los hijos que la cola padre **contiene de verdad**, cada uno con su velocidad efectiva:
- `activo`: velocidad y ráfaga del plan; `limitado`: velocidad limitada, sin ráfaga.
- `suspendido` no cuenta (su cola sale del padre o va al perfil de corte). Tampoco un servicio **sin cola**: PPPoE sin sesión abierta en `network.sesiones`, WISP sin IPv4.
- Sesiones PPPoE (colas dinámicas): cuenta lo mayor, por componente, entre lo que dice la base (sesiones abiertas por estado) y lo que el router ya tiene colgando del padre (`max-limit`, `burst-limit` y `limit-at` de cada cola dinámica). Así un accounting o un CoA en camino no deja el padre por debajo de lo que el router ya tiene, ni dispara una regla de oro falsa.
- Se recalcula por evento como hasta ahora: `servicio.estado_cambiado` (limitar, suspender, reactivar), `servicio.config_cambiada`, `sesion.iniciada` / `sesion.terminada`, `plan.velocidad_cambiada`, y en cada reconciliación.

### Sin hijos

`max-limit` = el pico de un hijo del plan (lo que tendría con el primero que llegue) y `limit-at = 0`. No se escribe 0 porque en RouterOS `max-limit=0` es «sin límite», y no se retira porque el perfil `plan-<id>` lo nombra en `parent-queue`; sale como hoy, cuando el plan ya no tiene servicios en el router y no le cuelgan sesiones.

### Padre del router y árbol

- **`argosisp-router`** (colas simples) y **`argosisp-global-<sentido>`** (árbol): la misma regla sin reuso, acotada por la capacidad del enlace: `min(capacidad, max(Σ MIR, max(pico)))` de sus hijos. Hijos del router: los padres de plan `jerarquico` (con su `max-limit` como MIR y pico y su `limit-at`), las colas WISP y PCQ de los clientes que cuelgan directo, y las sesiones PPPoE directas (base o router, lo mayor). Un padre de plan que no se reescribe (regla de oro) cuenta como está en el router. Sin hijos: la capacidad (0 = sin techo si el router no la tiene). Capacidad null: la suma de los hijos.
- **Nodos de plan del árbol:** cada nodo (`activo` y `limitado` por separado) es homogéneo: `limitesPadrePlan` con los clientes de ese estado cuya dirección está en la lista del plan (PPPoE con sesión abierta). Sin clientes: el pico de uno, `limit-at` 0. Los nodos sin nivel de plan (`por_router`) siguen con `max-limit=0` (el tope lo pone el PCQ) y aportan sus clientes al global.
- La regla de oro del router y del árbol sigue igual: `Σ limit-at` de los hijos ≤ capacidad del enlace (`limit_at_router`, `limit_at_global`).

### Ejemplo: plan 20/10 Mbps (bajada/subida), reúso 1:4, CIR 25 %

| Clientes | Antes | Sin ráfaga | Con ráfaga 30/15 | `limit-at` |
| --- | --- | --- | --- | --- |
| 0 | 5M / 2.5M (`limit-at` 0) | 20M / 10M | 30M / 15M | 0 |
| 1 | 5M / 2.5M | 20M / 10M | 30M / 15M | 5M / 2.5M |
| 2 | 10M / 5M | 20M / 10M | 30M / 15M | 10M / 5M |
| 8 | 40M / 20M | 40M / 20M | 40M / 20M | 40M / 20M |

### En un router existente

La reconciliación (y el siguiente evento de cualquier servicio del router) reescribe los `max-limit` y `limit-at` de los padres que no cumplen; las colas de los clientes no se tocan y nadie se desconecta. Cambia: padres de plan con pocos hijos suben al pico del hijo más rápido; padres con servicios sin sesión o suspendidos bajan a lo que de verdad contienen; un limitado cuenta a su velocidad limitada; `argosisp-router` y los globales del árbol bajan de la capacidad a la suma de sus hijos cuando esta es menor.

Implementación: `apps/api/app/network/velocidad.ts` (`hijosDelPlan`, `topePadre`, `limitesPadrePlan`, `limitesPadreSuma`), `routeros/consultas.ts` (`planesDeRouter`: quién es hijo) y `routeros/velocidad_router.ts` (`maxLimitRouter`, padres de plan, del router y del árbol).
