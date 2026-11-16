---
orden: 3
---

# Permisos (ACL)

Cada operación que cambia algo es una acción con nombre, y **el permiso se llama igual que la acción**: `POST /servicios/:id/suspender` ejecuta `servicios.suspender` y exige el permiso `servicios.suspender`. Los roles agrupan permisos; un usuario tiene un permiso si alguno de sus roles lo incluye. El catálogo vive en [`apps/api/app/core/permisos.ts`](../../apps/api/app/core/permisos.ts) y la tabla completa está en [Tabla de permisos](./referencia/permisos.md), generada de ese archivo en cada compilación del sitio.

## Cómo se comprueba

- Cada ruta declara su permiso; en la referencia aparece como **Permiso** y en el OpenAPI como `x-permiso`. Una ruta sin permiso (por ejemplo `GET /me`) solo pide estar autenticado.
- Sin el permiso: `403` con `type` `urn:argosisp:problema:prohibido` y `detail` `Se requiere el permiso servicios.suspender`.
- Con un token de API, el permiso tiene que estar en los permisos del usuario **y**, si el token los recorta, en `alcances.permisos`.
- `GET /api/v1/me` devuelve `permisos[]`: la lista efectiva (con el recorte del token). Úsala para decidir qué ofrecer en una interfaz; el servidor vuelve a comprobar siempre.

## Roles base

Los crea el seed (`database/seeders/acl_seeder.ts`) desde `ROLES_BASE`:

| Rol            | Para quién                                                      | Notas                                                                                                                                                                                                                           |
| -------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `admin`        | Acceso total                                                    | Tiene todos los permisos del catálogo, también los nuevos.                                                                                                                                                                      |
| `cajero`       | Cobro en caja: pagos, turnos y promesas                         | No tiene `routers.*` ni `servicios.suspender`.                                                                                                                                                                                  |
| `soporte`      | Atención al cliente y gestión de servicios                      | Suspende, reactiva y limita servicios; ve routers y redes sin cambiar su configuración.                                                                                                                                         |
| `tecnico`      | Red: routers, IPAM, planes por router, sesiones e instalaciones | Activa instalaciones y mueve inventario de campo.                                                                                                                                                                               |
| `contabilidad` | Facturación, pagos, libro, cierres y localización fiscal        | Sin los permisos fiscales reservados a `admin`: `fiscal.instalar`, `fel.configurar`, `libro.bloquear_duro`, `libro.reabrir_ejercicio`, `libro.excepcion_bloqueo` y `empresas.cambiar_pais`; en lealtad, sin `sorteos.ejecutar`. |
| `lectura`      | Solo lectura                                                    | Todos los permisos `*.ver` más `clientes.estado_cuenta`.                                                                                                                                                                        |

Los permisos de un rol base se definen en código: `PUT /roles/:id` con `permisos` sobre un rol base responde `422 rol_base`. Para otra combinación, crea un rol propio con `POST /roles` (`roles.crear`). `GET /roles/base` devuelve los roles base con sus permisos y `GET /permisos` el catálogo con su descripción (ambos con `roles.ver`).

## Alcances

Además de los permisos, el acceso puede acotarse a ciertos recursos.

### Por rol: router, zona o caja

Cada asignación de rol a un usuario puede llevar un alcance: `PUT /usuarios/:id` (`usuarios.editar`) recibe `roles: [{ role_id, alcance_tipo, alcance_id }]` con `alcance_tipo` = `router`, `zona` o `caja` (o `null` para global).

- Si **alguna** asignación que da el permiso es global, el permiso no tiene restricción.
- Si **todas** tienen alcance, el usuario solo actúa sobre recursos de esos routers, zonas o cajas. En una lista, los demás no aparecen; sobre un recurso concreto, `403` con `detail` `El recurso está fuera del alcance (router, zona o caja) de tus permisos`.
- Un alcance solo limita los recursos que tienen esa dimensión: un rol con alcance de caja no limita qué clientes ve; uno con alcance de router sí limita servicios y clientes.

### Por token de API

`alcances` del token (`permisos`, `routers`, `zonas`, `cajas`) se aplica **además** del alcance de los roles: se combinan con Y. Ver [Autenticación](./autenticacion.md#tokens-de-api).

### Por empresa

En multiempresa, `PUT /usuarios/:id/empresas` (`usuarios.asignar_empresas`) define en qué empresas trabaja el usuario o le da alcance global. Fuera de ellas: `403 empresa_no_permitida`. Ver [Multiempresa](./arquitectura.md#multiempresa).

## Usuarios técnicos de las integraciones

Horus e Iris entran con un token `atk_` de un usuario técnico con los permisos de su contrato. El de Iris solo admite alcance por empresas, nunca por router ni zona (`422 usuario_tecnico_solo_empresas`). Ver [Integraciones](./integraciones.md).

## Permisos que no salen de una ruta

Algunos permisos se comprueban dentro de una acción y no aparecen como permiso de ninguna ruta, por ejemplo `servicios.adicional_cortesia` (se exige además de agregar o editar un adicional) o `egresos.registrar_sin_limite`. La tabla los marca sin rutas.

## Relacionado

- [Tabla de permisos](./referencia/permisos.md)
- [Referencia de la API](./referencia/)
