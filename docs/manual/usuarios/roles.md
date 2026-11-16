---
orden: 2
pantallas:
    - /usuarios/roles
---

# Roles y permisos

Un **rol** es un grupo de permisos. Un **permiso** es el nombre de una acción del panel, por ejemplo `servicios.suspender` o `pagos.registrar`. Aquí ves qué permisos tiene cada rol, creas roles propios y buscas qué roles tienen un permiso.

## Quién la usa

- Ver: `roles.ver` (`admin`; `lectura` la ve sin cambiar nada).
- Crear roles: `roles.crear`. Editar: `roles.editar` (`admin`).

## Qué ves

### Roles

Cada rol con su descripción, la marca «Base» si es uno de los que trae ArgosIsp y cuántos permisos tiene. El lápiz lo edita; sin `roles.editar`, el ojo lo muestra en solo lectura.

Los roles base son `admin`, `cajero`, `soporte`, `tecnico`, `contabilidad` y `lectura`. Ver [Conceptos: permisos y roles](../../guia/conceptos.md#permisos-y-roles).

### Catálogo de permisos

Todos los permisos de ArgosIsp con su descripción y los roles que lo tienen. El buscador filtra por nombre.

## Acciones

### Crear un rol

- **Permiso:** `roles.crear`
- **Dónde:** «Nuevo rol».
- **Campos:**
    - **Nombre:** minúsculas, números y guion bajo (por ejemplo `cobrador_zona`). No cambia después.
    - **Descripción.**
    - **Permisos:** agrupados por módulo, con buscador y «Todos» o «Ninguno» por grupo.
- **Qué pasa:** el rol queda listo para asignarlo a usuarios en [Usuarios](usuarios.md).

### Editar un rol

- **Permiso:** `roles.editar`
- En un rol propio cambias la descripción y los permisos. El nombre no cambia.
- En un **rol base** solo se edita la descripción: sus permisos se definen en ArgosIsp y se actualizan con cada versión. Para otra combinación, crea un rol propio.

::: tip El alcance va en el usuario
El rol dice **qué** se puede hacer. **Dónde** (un router, una zona o una caja) se elige al asignar el rol a cada usuario.
:::

## Preguntas frecuentes

**¿Puedo quitarle a `cajero` un permiso?** No: los permisos de un rol base no se editan. Crea un rol propio con los permisos que quieras y asígnalo en su lugar.

**Mientras editabas, alguien más guardó el rol.** Verás un error de conflicto. Recarga y vuelve a aplicar el cambio.

## Relacionado

- [Usuarios](usuarios.md)
- [Tokens de API](tokens.md)
