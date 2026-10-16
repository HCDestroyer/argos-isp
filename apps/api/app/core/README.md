# core (A1)

Usuarios, ACL, tokens de API, zonas, clientes y servicios.

## ACL

- Permiso = nombre de la acción (`servicios.suspender`), catálogo en `permisos.ts`; roles base en el mismo archivo, sincronizados por `database/seeders/acl_seeder.ts`. Los permisos de un rol base no se editan por API: se crea un rol propio.
- `usuarios_roles.alcance_tipo/alcance_id` limita un rol a un router, zona o caja. `autorizar(permiso)` deja en `ctx.alcance` con qué alcance se tiene el permiso; las rutas lo aplican con `filtrarPorAlcance` (listas) y `exigirAlcance` (un recurso) de `acl.ts`. Un alcance solo restringe recursos que tienen esa dimensión.
- Tokens de API: `Authorization: Bearer atk_...` (guard `tokens`, `auth/token_api_guard.ts`). Se guarda el sha256. `alcances = { permisos?, routers?, zonas?, cajas? }` recorta los permisos y el alcance del usuario dueño. Las acciones hechas con un token se auditan con `actor_tipo = 'token'`.

| Acción                             | Permiso                             | Eventos                                   |
| ---------------------------------- | ----------------------------------- | ----------------------------------------- |
| `CrearUsuario`, `EditarUsuario`    | `usuarios.crear`, `usuarios.editar` | — (auditoría y cambios; contraseña nunca) |
| `CrearRol`, `EditarRol`            | `roles.crear`, `roles.editar`       | —                                         |
| `CrearTokenApi`, `RevocarTokenApi` | `tokens.crear`, `tokens.revocar`    | —                                         |

Lecturas en `consultas/acl.ts`.

## Clientes y zonas

- NIT con dígito verificador (módulo 11, `K`) o CUI de 13 dígitos (verificador y departamento) o `CF`; se guardan normalizados (`nit_cui.ts`). Sin columna `saldo`: el saldo es el auxiliar del libro.
- `buscarClientes` (`consultas/clientes.ts`): nombre, nombre fiscal, correo, NIT/CUI, teléfono o móvil (solo dígitos), `user_ppp` o IP (IPv4 vigente, o IPv6 dentro de un prefijo vigente). Alcance por zona y por router (clientes con servicios en el router).
- Telegram (día 4): `VincularTelegramCliente` / `DesvincularTelegramCliente` fijan o borran `telegram_chat_id` (texto, `^-?\d{1,20}$`) con diff en `audit.cambios` (no es secreto). Idempotentes: el mismo chat o desvincular sin chat no cambian nada. `POST /clientes/:id/vincular-telegram { chat_id }` y `POST /clientes/:id/desvincular-telegram`; el webhook del bot (A6) llama la acción directamente.
- Filtros de `GET /clientes` (día 3): `zona_id`, `estado_servicio`, `router_id` y `plan_id` (los tres se exigen sobre **el mismo** servicio del cliente), `con_deuda_vencida` (alguna `billing.facturas` en `vencida`; `false` = ninguna) y `con_promesa_activa` (`billing.promesas` en `activa`). Se combinan con `q`. Lectura de `billing` sin escribir nada (A3 es dueño).

## Servicios

| Acción                                                                                           | Permiso                                                       | Eventos                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `CrearServicio`                                                                                  | `servicios.crear`                                             | `servicio.creado`, `asignacion.cambiada`                                                                                    |
| `EditarServicio` (con `version`)                                                                 | `servicios.editar`                                            | `servicio.config_cambiada` (campos `plan`, `router`, `ips`, `prefijo_v6`) y `asignacion.cambiada` si cambian IPs o prefijos |
| `RetirarServicio`                                                                                | `servicios.retirar`                                           | `servicio.estado_cambiado` (`a: retirado`), `asignacion.cambiada` (vacía, con `fin`)                                        |
| `CambiarEstadoServicio` (interfaz pública, la llama `evaluarEstadoServicio` de A3 con `{ trx }`) | `servicios.cambiar_estado` (no se asigna a roles)             | `servicio.estado_cambiado`                                                                                                  |
| `SuspenderServicio` (desde activo o limitado)                                                    | `servicios.suspender`                                         | `servicio.estado_cambiado`                                                                                                  |
| `ReactivarServicio` (desde suspendido o limitado → activo)                                       | `servicios.reactivar`                                         | `servicio.estado_cambiado`                                                                                                  |
| `LimitarServicio` (desde activo o suspendido)                                                    | `servicios.limitar`                                           | `servicio.estado_cambiado`                                                                                                  |
| `QuitarLimiteServicio` (desde limitado → activo)                                                 | `servicios.quitar_limite`                                     | `servicio.estado_cambiado`                                                                                                  |
| `VerCredencialesServicio`                                                                        | `servicios.ver_credenciales`                                  | — (cada consulta queda auditada)                                                                                            |
| `CrearCliente`, `EditarCliente`                                                                  | `clientes.crear`, `clientes.editar`                           | —                                                                                                                           |
| `VincularTelegramCliente`, `DesvincularTelegramCliente`                                          | `clientes.vincular_telegram`, `clientes.desvincular_telegram` | —                                                                                                                           |
| `CrearZona`, `EditarZona`                                                                        | `zonas.crear`, `zonas.editar`                                 | —                                                                                                                           |

- Estados: las acciones manuales (`POST /servicios/:id/suspender|reactivar|limitar|quitar-limite`, `motivo` obligatorio, `Idempotency-Key` opcional) validan el estado de origen (422 `transicion_invalida`), ejecutan `CambiarEstadoServicio` anidada y devuelven el servicio. Si ya está en el destino responden 200 sin evento. Retirado: 422 `servicio_retirado`. La decisión automática por facturas es solo de `evaluarEstadoServicio` (A3).
- Alta: `user_ppp` `<nombre>.<cliente_id>` (y `-2`, `-3`… si se repite) y `pass_ppp` de 12 caracteres si no vienen. `pass_ppp` se guarda cifrada (formato `v1`, `AAA_PPP_KEY`) y nunca sale en la vista del servicio.
- IPv4: la pedida o la primera libre del router; con `red_ipv4_id` (solo en el alta), la primera libre de esa red (422 en `red_ipv4_id` si no existe, no es del router o está llena; 422 en `ipv4` si la IP pedida no es de esa red). Sin redes en el router se acepta si el plan define `pool_ipv4` en ese router. Plan `v6` no lleva IPv4.
- Plantilla de facturación en el alta (`plantilla_por_defecto.ts`): un id → esa; `null` explícito → sin plantilla; **ausente** en `POST /servicios` → la única plantilla si hay una, ninguna si no hay, 422 en `plantilla_facturacion_id` si hay varias. Así el `tecnico` (sin `plantillas.ver`) crea servicios. Las llamadas internas a `CrearServicio` (importador) solo usan la regla con `plantillaPorDefecto: true`. Cuando A3 agregue la marca `por_defecto`, cambia solo `plantillaPorDefecto`.
- IPv6 según `ipv6_modo` (por defecto `radius_servicio`, o `ninguno` con plan `v4`): `radius_servicio` reserva /64 de enlace y delegado del tamaño del plan; `duid` solo delegado (exige `ipv6_duid`); `estatico` exige `prefijo_delegado_v6`; `radius_pool` y `ninguno` no reservan. Ver `asignaciones_servicio.ts`.
- `GET /servicios`: `q`, `cliente_id`, `router_id`, `plan_id`, `estado`, `zona_id` (zona del cliente) y `con_deuda_vencida` (facturas del servicio). La vista `Servicio` trae `cliente_nombre`, `plan_nombre`, `router_nombre` y `zona_nombre` (para roles sin `routers.ver` ni `zonas.ver`); en el OpenAPI son opcionales para no romper fixtures, pero la API siempre los envía.
- Bitácora (`app/shared/bitacora.ts`): `GET /bitacora/acciones` filtra además por `cliente_id` (acciones con entidad `cliente` y las de sus `servicio`, `factura`, `pago` y `promesa`), `canal` y `excluir_canal` (p. ej. `portal`), y trae `actor_nombre` (null para el sistema).
- Índices de estos filtros: `1761100000002_indices_filtros_listados`.
- Interfaces públicas (solo lectura): `obtenerConfiguracionEfectiva(servicio_id, trx?)` (`actions/obtener_configuracion_efectiva.ts`): servicio, plan efectivo, plantilla, excepciones y `facturacion` (plantilla con las excepciones aplicadas por `aplicarExcepciones` de A3; null sin plantilla). Por HTTP: `GET /servicios/:id/configuracion-efectiva` (`servicios.ver`) → `{ servicio_id, plantilla_facturacion_id, plan, facturacion, excepciones }`.
- Historial de asignaciones (tarea 12, `app/network/historial.ts`): `GET /servicios/:id/asignaciones` (`servicios.ver`, cursor), del tramo más reciente al más viejo. Ver el README de `network`.

### Excepciones a la plantilla (tarea 11, `excepciones_servicio.ts`)

- `POST /servicios` y `PUT /servicios/:id` aceptan `excepciones: { campo: valor }`. Los campos y la validación son de A3 (`app/billing/excepciones.ts`: `CAMPOS_EXCEPCION`, `validarExcepcion`); A1 no repite la lista. Errores 422 por `excepciones.<campo>` (campo no exceptuable o valor inválido).
- `null` en un campo borra la excepción; un campo ausente no se toca. Se guardan en `core.servicios_excepciones` (`servicio_id`, `campo`, `valor jsonb`).
- `audit.cambios` por campo como `excepcion_<campo>` en la entidad `servicio`. La vista `Servicio` trae `excepciones` (opcional en el OpenAPI; la API siempre lo envía).
- Si cambia `facturas_para_limitar`, `facturas_para_cortar` o `reglas_promesa`, `EditarServicio` llama `EvaluarEstadoServicio` (A3) anidada: A3 decide si cambia el estado (y su `servicio.estado_cambiado` sale en la misma transacción). A1 no decide estados.

### Columnas que lee facturación (A3, `generarFacturas`)

No cambian de nombre sin acuerdo en `.claude/integration/` (reglas en su README):

- `core.servicios`: `id`, `cliente_id`, `plan_id`, `plantilla_facturacion_id`, `costo_override` (numeric(14,2), null = precio del plan), `fecha_instalacion` (date), `estado` (`activo`/`limitado`/`suspendido`/`retirado`).
- `network.planes`: `precio` (numeric(14,2)), `bajada_limitada_kbps`, `subida_limitada_kbps` (> 0).

## Autorización RADIUS (`aaa.ts`, tarea 9)

- Contrato con A2: `.claude/integration/contratos/aaa.md`. `GET /api/v1/internal/aaa/servicio?user_ppp=` (Bearer `INTERNAL_TOKEN`) arma el JSON desde Postgres: 404 si no existe; retirado → 200 con `estado: retirado`.
- Redis `aaa:user:<user_ppp>` (prefijo `AAA_REDIS_PREFIJO`; en pruebas `<COLAS_PREFIJO>:aaa:user:`), **sin TTL**, write-through después del COMMIT con `refrescarAaaAlConfirmar(t, objetivo)`: `CrearServicio`, `EditarServicio`, `RetirarServicio` (lápida), `CambiarEstadoServicio` (y las acciones manuales que la anidan), `EditarPlan` (todos los servicios no retirados del plan) e `ImplementarPlan` (los del plan en ese router).
- SET condicionado por `version` (Lua): un registro del mismo servicio con `version` mayor no se pisa. Tras restaurar un respaldo de la base, borrar `aaa:user:*`.
- Si Redis falla en el gancho, el cambio queda confirmado y se registra en el log; el consumidor `aaa-cache` del bus de eventos vuelve a escribir la clave.

## Bus de eventos (`app/shared/eventos_bus.ts`, `app/shared/relay_outbox.ts`, tarea 10)

- Contrato: `.claude/integration/contratos/eventos.md`. `node ace eventos:relay` publica `audit.outbox` (pendientes, en orden de `id`, por lotes) en el stream `argos:eventos` (`EVENTOS_STREAM`; en pruebas `<COLAS_PREFIJO>:argos:eventos`) y marca `publicado_en`. Un solo relay activo (lock en Redis con dueño y renovación).
- `EjecutorGrupo` (genérico para A1, A3 y A6): `XREADGROUP` + `XACK`, `XAUTOCLAIM` tras 60 s si un consumidor lanzó. Interfaz `ConsumidorEventos` / `EventoEntrante` (reexportada en `app/notify/consumidor.ts`).
- Grupo `aaa-cache` (`consumidor_aaa.ts`): `servicio.*` y `asignacion.cambiada` reescriben `aaa:user:<user_ppp>`. Corre dentro de `eventos:relay`. El grupo `notify` corre dentro de `node ace notify:worker`.
- Eventos que emite el núcleo: `servicio.creado`, `servicio.estado_cambiado`, `servicio.config_cambiada`, `asignacion.cambiada`. Consume: los anteriores (grupo `aaa-cache`).
- Dependencias con otros módulos: llama `EvaluarEstadoServicio` de A3 (solo al cambiar excepciones que afectan el corte) y lee `configuracionDeServicio` de `app/billing/configuracion.ts`. Pedidos y avisos en `.claude/integration/a1.md`.
