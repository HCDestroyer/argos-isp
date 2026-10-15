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
