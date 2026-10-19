# Contrato: servicios adicionales

Decisión del PM, 19 de octubre. Un servicio de internet puede tener **servicios adicionales**: una cuenta de streaming, usuarios de IPTV… Lo principal es marcar que el servicio tiene el adicional, con su identificador. Puede venir **incluido** en el plan, darse **de cortesía** o **cobrarse aparte**. Lo implementa A1 (`apps/api/app/core/adicionales.ts`, acciones en `app/core/actions/*adicional*`, rutas en `start/routes/adicionales.ts`).

## Datos

| Tabla | Qué guarda |
| --- | --- |
| `core.adicionales` | Catálogo **por empresa**: `empresa_id`, `codigo` (único por empresa, en mayúsculas, también entre los inactivos), `nombre`, `descripcion`, `precio_sugerido` (`numeric(14,2)`, nulable), `activo`, `version`. Se desactiva, nunca se borra. |
| `core.motivos_cortesia` | Por qué se regala un adicional: `empresa_id` (**null = común** a todas las empresas), `codigo`, `nombre`, `activo`, `version`. La migración trae los comunes `PROMOCION`, `CORTESIA`, `GARANTIA`, `COMPENSACION_FALLA` y `CONVENIO`; cada empresa agrega los suyos. No existía un catálogo de motivos parecido en el repositorio. |
| `core.servicios_adicionales` | Asignación: `empresa_id` (la del servicio), `servicio_id`, `adicional_id`, `modalidad` (`incluido`, `cortesia`, `cobrado`), `identificador` (usuario de IPTV, correo de la cuenta…), `credencial` (cifrada), `precio` (solo y obligatorio con `cobrado`, > 0), `motivo_id` (solo y obligatorio con `cortesia`) y `motivo_detalle` (texto libre opcional), `plan_id` (el plan que trajo un `incluido`), `estado` (`activo`, `baja`), `alta_en`, `baja_en`, `motivo_baja`, `version`. **No es único**: un servicio puede tener el mismo adicional varias veces (3 usuarios de IPTV). |
| `network.planes_adicionales` | Adicionales que trae cada plan: `plan_id`, `adicional_id`, `cantidad` (1 a 50). |

- Un trigger rechaza una asignación cuyo adicional (o, al insertar, cuyo servicio) es de otra empresa, o cuyo motivo es de otra empresa.
- Los CHECK de la base repiten las reglas de precio, motivo y baja.
- **Credencial**: se cifra con el mismo mecanismo que `pass_ppp` (`#shared/cifrado`, `v1.<iv>.<tag>.<datos>`, clave `AAA_PPP_KEY`). En `audit.cambios` y en `audit.acciones.entrada` va como `***` (`credencial` está en `#shared/enmascarar`). Nunca sale en listas ni en eventos: las vistas traen `tiene_credencial`. Se lee en claro solo con `GET /servicios/:id/adicionales/:asignacionId/credencial` (permiso `servicios.ver_credencial_adicional`, el mismo patrón que `servicios.ver_credenciales` de PPPoE); cada lectura queda en `audit.acciones`.

## Reglas

### Asignar, editar y quitar

- El adicional debe ser de la empresa del servicio (422 `adicional_de_otra_empresa`) y estar activo (422 `adicional_inactivo`).
- Un servicio retirado no admite cambios (422 `servicio_retirado`). Suspendido o limitado, sí: los adicionales son informativos y la facturación decide qué hacer con los `cobrado`.
- Dar una cortesía (agregarla, pasar a `cortesia` o cambiar su motivo) exige además `servicios.adicional_cortesia` (403).
- Editar lleva `version` (409). Al dejar de ser `cobrado` se borra el precio; al dejar de ser `cortesia`, el motivo; al dejar de ser `incluido`, su `plan_id` (un cambio de plan ya no lo da de baja). El adicional de una asignación no cambia: se quita y se agrega otro.
- Quitar es una baja con fecha (`estado = baja`, `baja_en`, `motivo_baja`), nunca DELETE. Una baja no se edita ni se vuelve a quitar (422 `adicional_dado_de_baja`).

### Plan con adicionales incluidos

- Los planes son de todas las empresas; su lista puede tener adicionales de varias. **Cada servicio recibe solo los de su empresa**, y solo los activos.
- **Al crear un servicio** se agregan los incluidos de su plan con `modalidad = incluido` y `plan_id` (evento con `origen: plan`).
- **Al cambiar de plan** (`PUT /servicios/:id` con otro `plan_id`) se reconcilian los `incluido`:
  - un `incluido` vigente de un adicional que el plan nuevo también trae **se conserva**, con su identificador y su credencial, hasta la cantidad del plan nuevo, y pasa a ese `plan_id`;
  - los demás `incluido` se dan de baja (`motivo_baja = cambio_plan`, evento con `origen: cambio_plan`);
  - los que faltan se agregan (`origen: plan`);
  - `cortesia` y `cobrado` **se conservan** siempre.
- **Un plan temporal no los toca** (inicio, fin y cancelación cambian `plan_id` sin pasar por esta regla).
- **Cambiar la lista de un plan no toca los servicios existentes**: se aplica al próximo alta o cambio de plan.

### Estado y empresa del servicio

- **Retirar** el servicio da de baja todos sus adicionales activos (`motivo_baja` = el motivo del retiro, evento con `origen: retiro`).
- **Suspender** los bloquea y **reactivar** los desbloquea (ver "Servicio suspendido"). **Limitar** no los toca.
- **Cambiar de empresa** (`servicios.cambiar_empresa`): con `cortesia` o `cobrado` vigentes responde 422 `servicio_con_adicionales` (se quitan antes: son del catálogo de la otra empresa). Los `incluido` se dan de baja (`origen: cambio_empresa`) y se agregan los que el plan trae en la empresa nueva.

### Servicio suspendido (decisión del PM, 19 oct)

- `core.servicios_adicionales.bloqueo` ∈ `vigente` | `bloqueado`, con `bloqueado_en`. Es aparte de `estado` (`activo` | `baja`): un adicional activo puede estar bloqueado.
- Cuando el servicio **entra** a `suspendido`, todos sus adicionales `activo` y `vigente` pasan a `bloqueado`. Cuando **sale** de `suspendido` (a `activo` o `limitado`), los bloqueados vuelven a `vigente`. Entre `activo` y `limitado` no pasa nada. Las bajas no se tocan.
- Un adicional que se agrega a un servicio suspendido (a mano o por cambio de plan) **nace bloqueado**.
- **Dónde se dispara:** de forma anidada en `CambiarEstadoServicio` (`aplicarBloqueoPorEstado` de `#core/adicionales`), dentro de la misma transacción que el cambio de estado. Es la única acción que cambia el estado de un servicio vivo: la usan `evaluarEstadoServicio` (corte, pagos, promesas) y las acciones manuales `suspender`, `reactivar`, `limitar` y `quitar-limite`. Así el estado y el bloqueo se confirman juntos o ninguno, sin una ventana en la que el servicio esté suspendido y la cuenta externa siga abierta. Es idempotente: solo toca las filas que todavía no están en el estado pedido, y `CambiarEstadoServicio` no hace nada si el servicio ya estaba en el estado nuevo. Se descartó un consumidor del bus porque deja esa ventana y tendría que adivinar el estado anterior.
- Cada bloqueo o desbloqueo:
  - deja su diff en `audit.cambios` (campos `bloqueo` y `bloqueado_en`, entidad `servicio_adicional`);
  - se guarda en el historial `core.servicios_adicionales_bloqueos` (solo inserción: trigger y `REVOKE`), con `accion`, `estado_servicio`, `motivo` y `request_id`;
  - emite `adicional.bloqueado` o `adicional.desbloqueado`.
  - No sube la `version` de la asignación: no es una edición de nadie, y así una edición del panel que llegue en el mismo momento no recibe 409.
- El bloqueo no se edita a mano. El panel lo muestra (`bloqueo`, `bloqueado_en` en `AdicionalServicio`) y su historial en `GET /servicios/:id/adicionales/:asignacionId/bloqueos` (`servicios.ver`).
- **Consumidores:** quien integre la cuenta externa (streaming, IPTV) bloquea o reactiva con estos eventos. Hoy no hay integración. Deben ser idempotentes: el evento puede llegar dos veces.

### Primer periodo de un cobrado (decisión del PM, 19 oct)

- Al agregar un adicional `cobrado` a mitad de periodo, `primer_periodo` ∈ `prorrateado` (por defecto) | `sin_costo`. Solo con `cobrado` (422 en `primer_periodo` con otra modalidad); se puede cambiar al editar.
- `cobrado_desde` (instante): desde cuándo se cobra. Es el alta o el momento en que una asignación pasa a `cobrado` al editarla (entonces `primer_periodo` toma `prorrateado` si no se indica). Al dejar de ser `cobrado` se borran los dos.
- Los cobrados que existían antes de esta decisión quedaron `prorrateado` con `cobrado_desde = alta_en`.

## API (`/api/v1`)

| Método y ruta | Permiso | Notas |
| --- | --- | --- |
| `GET /adicionales?q=&activo=&empresas=&cursor=&limit=` | `adicionales.ver` | Catálogo de la empresa activa (consolidado con `empresas=todas`) |
| `POST /adicionales` | `adicionales.crear` | `empresa_id` opcional (por defecto la activa); 409 `adicional_duplicado`; `Idempotency-Key` |
| `GET /adicionales/:id` | `adicionales.ver` | 403 si es de una empresa fuera del alcance |
| `PUT /adicionales/:id` | `adicionales.editar` | Con `version` |
| `POST /adicionales/:id/desactivar` | `adicionales.desactivar` | Con `version`; ya inactivo, 200 sin cambios |
| `GET /adicionales/motivos?activo=&empresas=` | `adicionales.ver` | Comunes más los de la empresa |
| `POST /adicionales/motivos` | `adicionales.crear_motivo` | 409 `motivo_duplicado` |
| `POST /adicionales/motivos/:id/desactivar` | `adicionales.desactivar_motivo` | Uno común, solo con alcance global |
| `GET /servicios/:id/adicionales?estado=&cursor=&limit=` | `servicios.ver` | Sin credenciales |
| `POST /servicios/:id/adicionales` | `servicios.agregar_adicional` (+ `servicios.adicional_cortesia`) | `Idempotency-Key` |
| `PUT /servicios/:id/adicionales/:asignacionId` | `servicios.editar_adicional` (+ `servicios.adicional_cortesia`) | Con `version`; `credencial: null` la borra |
| `POST /servicios/:id/adicionales/:asignacionId/quitar` | `servicios.quitar_adicional` | Con `version` y `motivo` opcional |
| `GET /servicios/:id/adicionales/:asignacionId/bloqueos` | `servicios.ver` | Historial de bloqueos y desbloqueos |
| `GET /servicios/:id/adicionales/:asignacionId/credencial` | `servicios.ver_credencial_adicional` | En claro, auditado; 422 `sin_credencial` |
| `GET /planes/:id/adicionales` | `planes.ver` | Lista con `cantidad` y `empresa_id` del adicional |
| `PUT /planes/:id/adicionales` | `planes.editar` | Reemplaza la lista; sube la `version` del plan (409); diff en `audit.cambios` (campo `adicionales`) |

Esquemas OpenAPI: `Adicional`, `MotivoCortesia`, `AdicionalServicio`, `AdicionalPlan`, `CredencialAdicional`, `BloqueoAdicional`. `POST` y `PUT` de `/servicios/:id/adicionales` aceptan `primer_periodo`. En `AdicionalServicio`, `bloqueo`, `bloqueado_en`, `primer_periodo` y `cobrado_desde` son opcionales en el esquema hasta que los fixtures del panel los tengan; la API siempre los envía.

## Permisos en los roles base

| Rol | Permisos |
| --- | --- |
| `admin` | todos |
| `soporte`, `tecnico` | `adicionales.ver`, `servicios.agregar_adicional`, `servicios.editar_adicional`, `servicios.quitar_adicional`, `servicios.ver_credencial_adicional` |
| `cajero`, `contabilidad` | `adicionales.ver` (y `servicios.ver`, que ya tenían) |
| `lectura` | `adicionales.ver` (todo `*.ver`) |

`servicios.adicional_cortesia` y la administración del catálogo y de los motivos quedan solo en `admin`.

## Eventos (outbox)

Todos con `servicio_id`, `cliente_id`, `empresa_id` (la de la asignación), `adicional_id`, `asignacion_id` y `modalidad`. **Nunca la credencial.** No cambian nada en la red: `aaa-cache` y `routeros` los ignoran.

| Evento | Además | Cuándo |
| --- | --- | --- |
| `servicio.adicional_agregado` | `origen`: `manual` o `plan`; `primer_periodo` (o null) y `bloqueo` | Alta a mano, alta del servicio o cambio de plan |
| `servicio.adicional_cambiado` | `campos[]` (`modalidad`, `identificador`, `credencial`, `precio`, `motivo`, `primer_periodo`) y `modalidad_anterior` | Edición con algún cambio (`credencial` solo dice que cambió) |
| `servicio.adicional_quitado` | `origen`: `manual`, `cambio_plan`, `retiro` o `cambio_empresa`; `motivo` (texto o null) | Baja |

Bloqueo por la suspensión del servicio:

| Evento | Payload | Cuándo |
| --- | --- | --- |
| `adicional.bloqueado` | `servicio_id`, `cliente_id`, `empresa_id`, `asignacion_id`, `adicional_id`, `identificador`, `modalidad`, `estado_servicio` (`suspendido`), `motivo` (el del cambio de estado) | El servicio entra a `suspendido`, o se agrega un adicional a un servicio suspendido |
| `adicional.desbloqueado` | ídem, con `estado_servicio` = `activo` o `limitado` | El servicio sale de `suspendido` |

## Para otros agentes

- **A3 (facturación de los `cobrado`)**: la línea mensual sale de `core.servicios_adicionales` con `modalidad = 'cobrado'` y `estado = 'activo'` en el periodo (`alta_en`/`baja_en`), `precio` y `empresa_id` (la del servicio). Los eventos sirven para reaccionar (prorrateo, nota de crédito), pero la fuente es la tabla. Qué hacer con un servicio suspendido lo decide A3; `bloqueo = 'bloqueado'` marca los periodos en que el adicional estuvo bloqueado (historial en `core.servicios_adicionales_bloqueos`).
  - **Primer periodo:** el periodo en curso al momento de `cobrado_desde` (el de la plantilla del servicio) se cobra según `primer_periodo`:
    - `prorrateado`: `precio × (días desde la fecha de `cobrado_desde`, en `America/Guatemala`, hasta el fin del periodo, inclusive) / días del periodo`, redondeado a 2 decimales con `decimal.js`, como línea propia en la **siguiente factura** que se genere.
    - `sin_costo`: el periodo en curso no se cobra.
    - Desde el periodo siguiente, `precio` completo.
    - Si `cobrado_desde` cae el primer día del periodo y ese periodo aún no se facturó, se cobra completo en ambos casos.
  - La línea debe ser idempotente: una sola por asignación y periodo (por ejemplo, clave `adicional:<asignacion_id>:<periodo>`).
- **A4 (pantallas)**: catálogo y motivos (admin), adicionales en la ficha del servicio, lista del plan en la ficha del plan. La credencial solo con el botón "Ver" (`servicios.ver_credencial_adicional`); la cortesía solo si el usuario tiene `servicios.adicional_cortesia`.
- **A5 (portal)**: mostrar al cliente sus adicionales activos (nombre, modalidad, identificador). **Nunca la credencial**. Leer con `listarAsignaciones` de `#core/adicionales` (o pedir a A1 un endpoint del portal).
