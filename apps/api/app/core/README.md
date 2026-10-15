# core (A1)

Usuarios, ACL, tokens de API, zonas, clientes y servicios.

## ACL

- Permiso = nombre de la acción (`servicios.suspender`), catálogo en `permisos.ts`; roles base en el mismo archivo, sincronizados por `database/seeders/acl_seeder.ts`. Los permisos de un rol base no se editan por API: se crea un rol propio.
- `usuarios_roles.alcance_tipo/alcance_id` limita un rol a un router, zona o caja. `autorizar(permiso)` deja en `ctx.alcance` con qué alcance se tiene el permiso; las rutas lo aplican con `filtrarPorAlcance` (listas) y `exigirAlcance` (un recurso) de `acl.ts`. Un alcance solo restringe recursos que tienen esa dimensión.
- Tokens de API: `Authorization: Bearer atk_...` (guard `tokens`, `auth/token_api_guard.ts`). Se guarda el sha256. `alcances = { permisos?, routers?, zonas?, cajas? }` recorta los permisos y el alcance del usuario dueño. Las acciones hechas con un token se auditan con `actor_tipo = 'token'`.

| Acción | Permiso | Eventos |
| --- | --- | --- |
| `CrearUsuario`, `EditarUsuario` | `usuarios.crear`, `usuarios.editar` | — (auditoría y cambios; contraseña nunca) |
| `CrearRol`, `EditarRol` | `roles.crear`, `roles.editar` | — |
| `CrearTokenApi`, `RevocarTokenApi` | `tokens.crear`, `tokens.revocar` | — |

Lecturas en `consultas/acl.ts`.

## Clientes y zonas

- NIT con dígito verificador (módulo 11, `K`) o CUI de 13 dígitos (verificador y departamento) o `CF`; se guardan normalizados (`nit_cui.ts`). Sin columna `saldo`: el saldo es el auxiliar del libro.
- `buscarClientes` (`consultas/clientes.ts`): nombre, nombre fiscal, correo, NIT/CUI, teléfono o móvil (solo dígitos), `user_ppp` o IP (IPv4 vigente, o IPv6 dentro de un prefijo vigente). Alcance por zona y por router (clientes con servicios en el router).

## Servicios

| Acción | Permiso | Eventos |
| --- | --- | --- |
| `CrearServicio` | `servicios.crear` | `servicio.creado`, `asignacion.cambiada` |
| `EditarServicio` (con `version`) | `servicios.editar` | `servicio.config_cambiada` (campos `plan`, `router`, `ips`, `prefijo_v6`) y `asignacion.cambiada` si cambian IPs o prefijos |
| `RetirarServicio` | `servicios.retirar` | `servicio.estado_cambiado` (`a: retirado`), `asignacion.cambiada` (vacía, con `fin`) |
| `VerCredencialesServicio` | `servicios.ver_credenciales` | — (cada consulta queda auditada) |
| `CrearCliente`, `EditarCliente` | `clientes.crear`, `clientes.editar` | — |
| `CrearZona`, `EditarZona` | `zonas.crear`, `zonas.editar` | — |

- Alta: `user_ppp` `<nombre>.<cliente_id>` (y `-2`, `-3`… si se repite) y `pass_ppp` de 12 caracteres si no vienen. `pass_ppp` se guarda cifrada (formato `v1`, `AAA_PPP_KEY`) y nunca sale en la vista del servicio.
- IPv4: la pedida o la primera libre del router; sin redes en el router se acepta si el plan define `pool_ipv4` en ese router. Plan `v6` no lleva IPv4.
- IPv6 según `ipv6_modo` (por defecto `radius_servicio`, o `ninguno` con plan `v4`): `radius_servicio` reserva /64 de enlace y delegado del tamaño del plan; `duid` solo delegado (exige `ipv6_duid`); `estatico` exige `prefijo_delegado_v6`; `radius_pool` y `ninguno` no reservan. Ver `asignaciones_servicio.ts`.
- Interfaces públicas (solo lectura): `obtenerConfiguracionEfectiva(servicio_id, trx?)` (`actions/obtener_configuracion_efectiva.ts`): servicio, plan efectivo, plantilla y excepciones. Las excepciones aplicadas con `aplicarExcepciones` de A3 llegan con la tarea 11.

### Columnas que lee facturación (A3, `generarFacturas`)

No cambian de nombre sin acuerdo en `.claude/integration/` (reglas en su README):

- `core.servicios`: `id`, `cliente_id`, `plan_id`, `plantilla_facturacion_id`, `costo_override` (numeric(14,2), null = precio del plan), `fecha_instalacion` (date), `estado` (`activo`/`limitado`/`suspendido`/`retirado`).
- `network.planes`: `precio` (numeric(14,2)), `bajada_limitada_kbps`, `subida_limitada_kbps` (> 0).
