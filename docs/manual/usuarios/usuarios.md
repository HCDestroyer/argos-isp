---
orden: 1
pantallas:
    - /usuarios
---

# Usuarios

Las personas que entran al panel: su correo, sus roles (qué pueden hacer), el alcance de cada rol (dónde lo pueden hacer) y las empresas en las que trabajan.

## Quién la usa

- Ver la lista: `usuarios.ver` (`admin`; `lectura` la ve sin cambiar nada).
- Crear: `usuarios.crear`. Editar, cambiar roles, desactivar y reactivar: `usuarios.editar`. Asignar empresas: `usuarios.asignar_empresas`. Todos de `admin`.

Arriba, las pestañas **Usuarios**, **Roles y permisos** y **Tokens de API** (cada una con su permiso).

## Qué ves

| Columna  | Qué muestra                                                               |
| -------- | ------------------------------------------------------------------------- |
| Usuario  | Nombre y correo.                                                          |
| Roles    | Cada rol con su alcance, si lo tiene (por ejemplo, un router o una zona). |
| Empresas | «Todas (alcance global)» o las empresas en las que trabaja.               |
| Estado   | Activo o Inactivo.                                                        |

## Acciones

### Crear un usuario

- **Permiso:** `usuarios.crear`
- **Dónde:** «Nuevo usuario».
- **Campos:** **Nombre**, **Correo** (con el que entra), **Contraseña** (al menos 8 caracteres), **Activo** y sus **roles**.
- **Roles:** «Agregar rol», elige el **Rol** y su **Alcance**:
    - **Todo:** sin restricción.
    - **Un router**, **Una zona** o **Una caja:** el rol solo vale ahí. Por ejemplo, un técnico con alcance en un router solo trabaja con ese router y sus servicios; un cajero con alcance en una caja solo cobra en esa caja.
- Un usuario puede tener varios roles, cada uno con su alcance.
- **Qué pasa:** el usuario ya puede entrar con su correo y contraseña. Sus empresas se asignan aparte, con «Asignar empresas».

### Editar un usuario

- **Permiso:** `usuarios.editar`
- **Qué se cambia:** nombre, correo, roles y alcances, si está activo y la contraseña («Nueva contraseña»; déjala vacía para no cambiarla).
- Sin el permiso `roles.ver` no se ven los roles y la edición no los toca.

### Desactivar y reactivar

- **Permiso:** `usuarios.editar`
- **Qué pasa:** un usuario inactivo no puede entrar y sus tokens de API dejan de funcionar. Nada se borra; se reactiva con el mismo botón. No puedes desactivarte a ti mismo.

### Asignar empresas

- **Permiso:** `usuarios.asignar_empresas`
- **Dónde:** el botón de empresas de la fila.
- **Qué pasa:** eliges en qué empresas (NIT) trabaja. El rol es el mismo; la empresa acota dónde aplica.
    - **Alcance global:** ve y opera todas las empresas y la vista consolidada. Solo quien tiene alcance global puede darlo.
    - Nadie puede asignar empresas fuera de su propio alcance: la lista solo trae las tuyas.

## Preguntas frecuentes y errores

**«La asignación excede tus permisos».** Solo puedes dar roles, alcances y empresas que tú mismo tienes. Tampoco puedes editar (ni cambiar la contraseña, el correo o las empresas) a un usuario que tiene más permisos que tú. Así nadie se sube permisos solo ni toma la cuenta de un administrador. Un administrador puede todo.

**«Alguien más cambió este usuario».** No se guardó. Cierra, vuelve a abrirlo y repite el cambio.

**Un usuario dice que no ve un botón.** Le falta el permiso de esa acción. Revisa sus roles en [Roles y permisos](roles.md): cada permiso tiene el mismo nombre que la acción.

**Un usuario no ve los clientes de otra empresa.** Revisa sus empresas y la empresa activa del selector de la barra superior.

## Relacionado

- [Roles y permisos](roles.md)
- [Tokens de API](tokens.md)
- [Conceptos: permisos y roles](../../guia/conceptos.md#permisos-y-roles)
