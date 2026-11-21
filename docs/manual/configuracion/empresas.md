---
orden: 2
pantallas:
    - /configuracion/empresas
---

# Empresas

Las empresas (NIT) con las que factura tu instalación de ArgosIsp: sus datos fiscales, su logo y qué empresa se sugiere para los servicios nuevos de cada zona y router.

## Quién la usa

- Ver: `empresas.ver` (`admin`, `lectura`).
- Crear: `empresas.crear`. Editar: `empresas.editar`. Logo: `empresas.cambiar_logo`. Desactivar: `empresas.desactivar`. Todos de `admin`.

## Cómo funciona la multiempresa

- Cada servicio factura con una empresa. Sus facturas, pagos, cajas y asientos nunca se mezclan con los de otra.
- La **empresa activa** se elige en el selector de la barra superior. El panel muestra los datos de esa empresa. «Todas las empresas» (vista consolidada) solo aparece con alcance global. Con una sola empresa, el selector no aparece.
- Al crear un servicio, se sugiere la empresa de la zona del cliente; si no tiene, la del router; si tampoco, la empresa activa de quien lo crea.
- Un servicio se pasa a otra empresa con «Cambiar empresa» en su [ficha](../clientes-y-servicios/servicios.md#cambiar-empresa).

## Pestaña Empresas

| Columna         | Qué muestra                                                      |
| --------------- | ---------------------------------------------------------------- |
| Empresa         | Logo, nombre comercial y razón social, con la marca «Principal». |
| NIT             | El NIT.                                                          |
| Régimen         | Régimen de ISR.                                                  |
| Página de corte | La URL de corte propia, si tiene.                                |
| Estado          | Activa o Inactiva.                                               |

### Crear o editar una empresa

- **Permisos:** `empresas.crear` («Nueva empresa») y `empresas.editar` («Editar»).
- **Campos:**
    - **NIT** (no se puede repetir entre empresas activas).
    - **Establecimiento (SAT):** al editar se cambia en **Configuración → Empresa y fiscal → Fiscal → Establecimientos**.
    - **País:** al crear la empresa se instala el paquete fiscal de ese país.
    - **Razón social** y **Nombre comercial** (el que ven los clientes y el selector de empresa).
    - **Régimen de ISR:** al editar se cambia en **Configuración → Empresa y fiscal → Fiscal**, con su vigencia y el aviso a la SAT.
    - **Dirección fiscal**, **Municipio** y **Departamento.**
    - **Teléfono**, **WhatsApp**, **Correo**, **Sitio web** y **Horario de atención.**
    - **Color de marca:** solo para el PDF y el correo.
    - **URL de corte (opcional):** al cortar un servicio, el cliente ve esta página en vez de la página de corte de ArgosIsp. Se permite automáticamente durante el corte.
- **Qué pasa:** los datos salen en las facturas, el portal y los avisos de esa empresa.

### Logo

- **Permiso:** `empresas.cambiar_logo`
- PNG o SVG de hasta 512 KB, con vista previa antes de subirlo. Sale en el portal, los avisos y los correos de esa empresa. «Quitar logo» lo borra.

### Desactivar una empresa

- **Permiso:** `empresas.desactivar`
- **Cuándo se puede:** no es la empresa principal y no tiene servicios sin retirar. Si los tiene, pásalos antes a otra empresa con «Cambiar empresa».
- **Qué pasa:** pide un motivo. La empresa deja de aparecer en el selector y no recibe servicios nuevos, y su NIT queda libre. No se borra: sus documentos siguen.

## Pestaña Sugerencias por zona y router

Dos tablas: cada **zona** y cada **router** con su **Empresa sugerida** (o «Sin sugerencia (empresa activa)»). Se guarda al elegir. Cambiar una zona pide `zonas.editar` y un router, `routers.editar`; sin ellos se ve en solo lectura.

La sugerencia solo afecta a los servicios nuevos: los que ya existen siguen con su empresa.

## Preguntas frecuentes y errores

**«Alguien más editó esta empresa».** Tus cambios no se guardaron. Cierra, vuelve a abrirla y aplica los cambios otra vez.

**El NIT ya existe.** Otra empresa activa tiene ese NIT; el error sale junto al campo.

**No me deja desactivar.** Es la empresa principal, ya está inactiva o todavía tiene servicios sin retirar.

## Relacionado

- [Conceptos: empresas](../../guia/conceptos.md#empresas-multiempresa)
- [Datos de contacto de la empresa](empresa.md)
- [Usuarios: asignar empresas](../usuarios/usuarios.md#asignar-empresas)
