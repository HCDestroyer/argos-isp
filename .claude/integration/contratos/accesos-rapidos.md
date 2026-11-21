# Contrato: accesos rápidos por usuario

Versión 1.0.0 · expone A6 (`apps/api/app/core`, tabla `core.accesos_rapidos`, rama `lider/salud-apariencia`) · lo consume el panel (`apps/web`, barra superior en todas las pantallas).

Pedido del PM: «Los accesos rápidos deben poder estar en cualquier pantalla.» El panel los pinta en la barra superior; la API guarda la lista de cada usuario.

## 1. Rutas

| Ruta | Acción / permiso | Quién |
| --- | --- | --- |
| `GET /api/v1/me/accesos-rapidos` (`meAccesosRapidos`) | lectura, sin permiso del ACL | el usuario de la sesión (como `/me`) |
| `PUT /api/v1/me/accesos-rapidos` (`meEditarAccesosRapidos`) | acción `accesos_rapidos.editar`, sin permiso especial | solo el propio usuario; nunca se edita la lista de otro |

Un token de API o un agente que sea usuario también tiene su lista. No dependen de la empresa activa.

## 2. Respuesta (`AccesosRapidos`)

```jsonc
{
    "secciones": ["clientes", "servicios", "cobro", "facturas", "routers", "configuracion"],
    "predeterminados": true,        // true: el usuario no ha guardado su lista y esta es la sugerida por rol
    "maximo": 12,
    "version": null                 // entero si el usuario guardó; null con predeterminados
}
```

- `secciones`: ids de sección del panel, en orden. Son los `id` de `apps/web/app/utils/navegacion.ts` (p. ej. `cobro`, `caja`, `clientes`, `servicios`, `facturas`, `comprobantes`, `routers`, `configuracion`). **La API no los valida contra el menú** (solo contra el patrón de §3): el panel ignora los ids que no conoce o que el usuario no puede ver por permisos, y no los borra.
- Lista vacía guardada = el usuario no quiere accesos (`predeterminados: false`, `secciones: []`).

### Predeterminados por rol

Si el usuario no guardó lista, `secciones` es la unión, en este orden de rol y sin repetidos, de los roles base que tiene (tope 12). Un usuario sin ninguno de estos roles recibe la de `lectura`.

| Rol | Secciones |
| --- | --- |
| `admin` | `clientes`, `servicios`, `cobro`, `facturas`, `routers`, `configuracion` |
| `contabilidad` | `libro`, `facturas`, `pagos`, `declaraciones`, `conciliacion`, `egresos` |
| `cajero` | `cobro`, `caja`, `clientes`, `comprobantes` |
| `soporte` | `clientes`, `servicios`, `promesas`, `routers` |
| `tecnico` | `servicios`, `routers`, `mi-bodega`, `clientes` |
| `lectura` | `clientes`, `servicios`, `facturas` |

(El brief decía «cobrar»: el id real de la sección del panel es `cobro`.)

## 3. `PUT /api/v1/me/accesos-rapidos`

Cuerpo JSON:

```jsonc
{ "secciones": ["cobro", "caja", "clientes"], "version": 2 }
```

| Campo | Regla |
| --- | --- |
| `secciones` | arreglo de 0 a 12 strings, cada uno `^[a-z0-9]+(?:[-_.][a-z0-9]+)*$` y ≤ 48 caracteres, **sin repetidos**; o `null` para **volver a los predeterminados** (borra la lista guardada) |
| `version` | entero u omitido. Si el usuario ya tiene lista guardada y se envía un `version` distinto → 409 `conflicto_version`. Omitido = último gana (es la preferencia de una sola persona) |

Responde 200 `AccesosRapidos` (con `version` nueva, o `predeterminados: true` si se envió `null`). Acepta `Idempotency-Key`. Auditoría: fila `accesos_rapidos.editar` con `entidad_tipo = 'usuario'` y el id del usuario, y diff de `secciones` en `audit.cambios`. No emite evento.

## 4. Errores

| Status | `type` | Cuándo |
| --- | --- | --- |
| 401 | `urn:argosisp:problema:no_autenticado` | Sin sesión |
| 409 | `urn:argosisp:problema:conflicto_version` | `version` desactualizada |
| 422 | `urn:argosisp:problema:validacion` | `errors[]` con `field` `secciones`, `secciones.<i>` o `version` (más de 12, patrón, repetidos) |
