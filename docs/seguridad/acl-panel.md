# ACL del panel (`apps/web`) · revisión de seguridad

Revisión adelantada de la semana 4, hecha por A4 en la semana 3 (tarea 3). Los permisos son los de
`apps/api/app/core/permisos.ts`; el panel usa el mismo nombre que la acción (`servicios.suspender`).
La API vuelve a validar todo (403); el panel no es la barrera, solo evita mostrar lo que no se puede usar.

## Cómo se protege una pantalla

| Capa | Dónde | Qué hace |
| --- | --- | --- |
| Ruta | `definePageMeta({ permiso })` + `app/middleware/02.permiso.global.ts` | Sin el permiso, la ruta redirige a `/sin-permiso?permiso=&ruta=` antes de montar la página: no se pide ningún dato |
| 403 amable | `app/pages/sin-permiso.vue` | Aviso, el permiso exacto que falta y "Volver al inicio"; sin tablas ni cifras |
| Menú | `app/utils/navegacion.ts` | Cada sección pide el mismo permiso que su página (lo comprueba la prueba) |
| Botones | `puede('<acción>')` en la página | Botón oculto sin su permiso; formularios con `:disabled` cuando se ven pero no se pueden guardar |
| Enlaces entre secciones | `enlace()`, `puedeAbrir()`, `destinoPermitido()` de `usePermisos` | Leen el `permiso` de la página destino; sin él no hay enlace (queda el texto) y, al guardar, se vuelve a `/` |
| Segundo permiso | `problemaSinPermiso()` (`app/utils/acl.ts`) | Si una pantalla necesita leer algo con otro permiso (editar un cliente lo lee con `clientes.ver`), muestra el 403 sin llamar a la API |

## Pruebas

| Prueba | Qué comprueba |
| --- | --- |
| `tests/nuxt/aclPantallas.test.ts` (estática) | (1) toda página declara permiso y el menú pide el mismo; (2) cada llamada a la API de una pantalla está cubierta por el `x-permiso` exacto de su endpoint en el OpenAPI (permiso de la página, `puede()` en el archivo, o el componente solo se abre desde pantallas que lo comprueban); (3) cada enlace a otra sección pasa por `enlace()`/`puedeAbrir()` o el archivo ya comprueba el permiso destino. Falla con la lista de huecos |
| `tests/nuxt/aclRoles.test.ts` (en ejecución) | Cada ruta con permiso (30) lleva a `/sin-permiso` con el permiso exacto a un usuario sin permisos; la página 403 no muestra datos; menú del cajero; `enlace()`; 17 pantallas con el rol `lectura` (todos los `*.ver`) sin ningún botón de acción, con control admin; ficha de servicio y factura con lectura y con admin; ficha de servicio con cajero; logout revoca el token |
| `tests/e2e/permisos.spec.ts` (Playwright, 1280 y 390) | El cajero no ve Routers en el menú y `/routers` lo manda a `/sin-permiso` |
| `pnpm verificar:permisos` (CI) | Todo permiso escrito en el panel existe en el catálogo |

## Checklist por pantalla

"Estática" = `aclPantallas.test.ts`; "Rutas" = la prueba de las 30 rutas de `aclRoles.test.ts`; "Lectura" = la prueba con el rol `lectura`.

| Pantalla | Ruta | Permiso requerido | Acciones y su permiso | Cómo se probó |
| --- | --- | --- | --- | --- |
| Inicio (tablero) | `/` | — (sesión) | Tablero solo con `reportes.ver`; accesos del menú filtrados; enlaces de los indicadores con `enlace()` (`servicios.ver`, `facturas.ver`, `pagos.ver`, `promesas.ver`) | Estática, `dashboard.test.ts` |
| Clientes | `/clientes` | `clientes.ver` | Nuevo cliente `clientes.crear`; filtros de zona, router y plan con `zonas.ver`, `routers.ver`, `planes.ver` | Rutas, Lectura (+ control admin), estática |
| Ficha de cliente | `/clientes/:id` | `clientes.ver` | Editar `clientes.editar`; Nuevo servicio `servicios.crear`; Cobrar `pagos.registrar`; pestaña Estado de cuenta `clientes.estado_cuenta`; Línea de tiempo `bitacora.ver`; Responsable de pago `clientes.asignar_responsable_pago` / `clientes.quitar_responsable_pago` | Rutas, Lectura, estática, `fichaCliente.test.ts` |
| Alta de cliente | `/clientes/nuevo` | `clientes.crear` | Guardar (misma acción); "Agregar servicio" del aviso con `servicios.crear`; al guardar va a la ficha solo con `clientes.ver` | Rutas, estática |
| Edición de cliente | `/clientes/:id/editar` | `clientes.editar` | Guardar (misma acción); leer el cliente pide `clientes.ver` (403 amable sin él) | Rutas, estática |
| Servicios | `/servicios` | `servicios.ver` | Nuevo servicio `servicios.crear`; filtros con `routers.ver`, `planes.ver`, `zonas.ver`; buscador de cliente con `clientes.ver` (deshabilitado sin él) | Rutas, Lectura, estática |
| Ficha de servicio | `/servicios/:id` | `servicios.ver` | Suspender, Reactivar, Limitar, Quitar límite, Retirar, Desconectar con `servicios.<acción>`; Editar `servicios.editar`; contraseña PPPoE `servicios.ver_credenciales`; sesión `sesiones.ver`; Promesa de pago `promesas.crear`; Simular y lista de promesas `promesas.ver`; Historial `bitacora.ver` | Rutas, lectura y admin, cajero, `fichaServicio.test.ts`, `suspensionManual.test.ts` |
| Alta de servicio | `/servicios/nuevo` | `servicios.crear` | Redes `redes.ver`, IPv6 `ipv6.ver`, plantilla `plantillas.ver` (sin ella usa la de por defecto); cliente con `clientes.ver` | Rutas, estática, `altaServicio.test.ts` |
| Routers | `/routers` | `routers.ver` | Velocidad: capacidad `routers.editar` (formulario deshabilitado sin él), modo de colas y su vista previa `routers.cambiar_control_velocidad`, rate-limit por plan `planes.ver` | Rutas, Lectura, `velocidad.test.ts`, `vistaPreviaControl.test.ts` |
| Planes | `/planes` | `planes.ver` | Nuevo plan `planes.crear`; Editar `planes.editar` | Rutas, Lectura (+ control admin), estática |
| Plantillas | `/plantillas` | `plantillas.ver` | Solo lectura (sin acciones todavía) | Rutas, Lectura |
| Cobrar | `/cobro` | `pagos.registrar` | Registrar (misma acción); estado de cuenta `clientes.estado_cuenta`; caja `cajas.ver`; cuentas `cuentas_bancarias.ver` y enlace a configurarlas con `cuentas_bancarias.editar` | Rutas, estática, `cobro*.test.ts` |
| Facturas | `/facturas` | `facturas.ver` | Filtro por servicio `servicios.ver`, por cliente `clientes.ver`; enlace al cliente con `enlace()` | Rutas, Lectura, estática |
| Detalle de factura | `/facturas/:id` | `facturas.ver` | Anular `facturas.anular`; pagos aplicados `pagos.ver`; asientos `libro.ver`; aviso PDF `facturas.ver` | Rutas, lectura y admin, `facturas.test.ts` |
| Pagos | `/pagos` | `pagos.ver` | Cobrar `pagos.registrar`; filtro de caja `cajas.ver`; cliente `clientes.ver` | Rutas, Lectura, estática |
| Detalle de pago | `/pagos/:id` | `pagos.ver` | Anular pago `pagos.anular`; facturas `facturas.ver`; asientos `libro.ver` | Rutas, Lectura (+ control admin), `pagos.test.ts` |
| Comprobantes | `/comprobantes` | `comprobantes.ver` | Enlaces a cliente y pago con `enlace()`; filtro de cliente `clientes.ver` | Rutas, Lectura, estática |
| Detalle de comprobante | `/comprobantes/:id` | `comprobantes.ver` | Aprobar `comprobantes.aprobar`; Rechazar `comprobantes.rechazar`; enlaces a pago `pagos.ver` y servicio `servicios.ver` | Rutas, `comprobantes.test.ts` |
| Caja | `/caja` | `cajas.ver` | Abrir turno `cajas.abrir`; Cerrar turno `cajas.cerrar`; cobros del turno `pagos.ver`; Cobrar `pagos.registrar` | Rutas, Lectura (+ control admin), `caja.test.ts` |
| Promesas | `/promesas` | `promesas.ver` | Crear `promesas.crear`; Aprobar `promesas.aprobar`; Rechazar `promesas.rechazar`; Cancelar `promesas.cancelar` | Rutas, Lectura, `promesas.test.ts` |
| Reportes | `/reportes`, `/reportes/:reporte` | `reportes.ver` | Descargar CSV/Excel (misma lectura); filtros con `zonas.ver`, `routers.ver`, `planes.ver`, `cajas.ver`, `clientes.ver` | Rutas, `reportes.test.ts` |
| Bitácora | `/bitacora` | `bitacora.ver` | Solo lectura; filtro por actor con `usuarios.ver` | Rutas, `bitacora.test.ts` |
| Libro | `/libro` | `libro.ver` | Cerrar periodo `libro.cerrar_periodo`; Reabrir `libro.reabrir_periodo`; filtro de egresos `egresos.ver` | Rutas, Lectura, `libro.test.ts` |
| Egresos | `/egresos` | `egresos.ver` | Registrar `egresos.registrar`; Anular `egresos.anular`; enlace al libro con `enlace()` | Rutas, Lectura (+ control admin), `egresos.test.ts` |
| Usuarios | `/usuarios` | `usuarios.ver` | Pantalla pendiente (sin acciones) | Rutas, Lectura |
| Cuentas bancarias | `/configuracion/cuentas-bancarias` | `cuentas_bancarias.ver` | Nueva y Editar `cuentas_bancarias.editar` | Rutas, Lectura (+ control admin), `cuentasBancarias.test.ts` |
| Empresa | `/configuracion/empresa` | `empresa.ver` | Guardar `empresa.editar` (formulario deshabilitado sin él) | Rutas, Lectura, `empresaDocumentos.test.ts` |
| Plantilla del aviso | `/configuracion/aviso-cobro` | `documentos.ver` | Guardar y vista previa `documentos.editar` | Rutas, `empresaDocumentos.test.ts` |
| Sin permiso | `/sin-permiso` | — | Ninguna | `aclRoles.test.ts` |
| Login | `/login` | pública | Entrar | `permisos.spec.ts` |

## Huecos encontrados y corregidos (semana 3)

1. **Cerrar sesión no revocaba el token.** `logout()` solo borraba la cookie; el token seguía valiendo hasta 12 h. Ahora llama `POST /auth/logout` (queda `auth.logout` en la bitácora) y luego borra la cookie.
2. **Enlaces a secciones sin permiso** (28): nombre del cliente en facturas, pagos, promesas, comprobantes y servicios; indicadores del tablero; "libro diario" en egresos; volver a la ficha al guardar o cancelar en alta y edición de cliente y servicio. Ahora pasan por `enlace()` / `destinoPermitido()`.
3. **Llamadas a la API sin el permiso del endpoint** (11): búsqueda del nombre del cliente del filtro (`clientes.ver`) en 7 pantallas, servicios del cliente en facturas y en el simulador (`servicios.ver`), leer el cliente al editarlo. Sin el permiso no se llaman; el buscador de clientes queda deshabilitado con el motivo.

Los roles base tienen todos `clientes.ver` y `servicios.ver`, así que 2 y 3 afectaban solo a roles a la medida; igual dejaban ver un 403 crudo o un enlace a `/sin-permiso`.

## Token: dónde se guarda y por qué

- **Hoy:** cookie `argos_token` escrita por el panel (`useCookie`, `SameSite=Lax`, 12 h), leída por `getToken` del cliente HTTP y enviada como `Authorization: Bearer`. **No se usa `localStorage`** para el token (solo para fallas simuladas de los fixtures).
- **CSRF:** la API autentica solo por el header `Authorization`, nunca por cookie, así que una página ajena no puede usar la cookie para llamar a la API.
- **XSS:** una cookie que lee JavaScript no es más segura que `localStorage` ante un script inyectado. La opción más segura sería una cookie `HttpOnly; Secure; SameSite=Strict` emitida por la API (o un BFF en Nitro) y que la API acepte la sesión por cookie con protección CSRF. Requiere cambios en `apps/api` (A1) y en el cliente HTTP del líder; queda propuesta en `.claude/integration/a4.md`, no se hace en el panel solo.
- **Mientras tanto:** el panel no usa `v-html` con datos de la API (salvo la vista previa del aviso, que es un PDF en `iframe` por `blob:`), el logout revoca el token, y conviene marcar la cookie `Secure` cuando el panel se sirve por HTTPS (una línea en `app/plugins/api.ts`, archivo del líder; propuesta en `a4.md`).
