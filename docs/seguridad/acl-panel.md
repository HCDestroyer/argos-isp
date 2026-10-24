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
| `tests/nuxt/aclRoles.test.ts` (en ejecución) | Cada ruta con permiso (30) lleva a `/sin-permiso` con el permiso exacto a un usuario sin permisos; la página 403 no muestra datos; menú del cajero; `enlace()`; 17 pantallas con el rol `lectura` (todos los `*.ver`) sin ningún botón de acción, con control admin; ficha de servicio y factura con lectura y con admin; ficha de servicio con cajero; logout revoca la sesión |
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
| Ficha de servicio | `/servicios/:id` | `servicios.ver` | Configuración efectiva y lista de planes temporales (`servicios.ver`); Programar mejora `servicios.programar_plan_temporal` (planes del router con `planes.ver`); Cancelar plan temporal `servicios.cancelar_plan_temporal`; Suspender, Reactivar, Limitar, Quitar límite, Retirar, Desconectar con `servicios.<acción>`; Editar `servicios.editar`; contraseña PPPoE `servicios.ver_credenciales`; sesión `sesiones.ver`; Promesa de pago `promesas.crear`; Simular y lista de promesas `promesas.ver`; Historial `bitacora.ver` | Rutas, lectura y admin, cajero, `fichaServicio.test.ts`, `suspensionManual.test.ts` |
| Alta de servicio | `/servicios/nuevo` | `servicios.crear` | Redes `redes.ver`, IPv6 `ipv6.ver`, plantilla `plantillas.ver` (sin ella usa la de por defecto); cliente con `clientes.ver` | Rutas, estática, `altaServicio.test.ts` |
| Routers | `/routers` | `routers.ver` | Velocidad: capacidad `routers.editar` (formulario deshabilitado sin él), modo de colas y su vista previa `routers.cambiar_control_velocidad`, rate-limit por plan `planes.ver` | Rutas, Lectura, `velocidad.test.ts`, `vistaPreviaControl.test.ts` |
| Ficha de router | `/routers/:id` | `routers.ver` | Nuevo router (en la lista) `routers.crear`; redes IPv4 `redes.ver` / agregar `redes.crear`; bloques y pools IPv6 `ipv6.ver` / agregar `ipv6.crear` (sin `*.ver`, la sección muestra el 403 sin llamar a la API) | Estática, `pendientesPanel.test.ts`, `e2e/pendientes-panel.spec.ts` |
| Planes | `/planes` | `planes.ver` | Nuevo plan `planes.crear`; Editar `planes.editar` | Rutas, Lectura (+ control admin), estática |
| Ficha de plan | `/planes/:id` | `planes.ver` | Editar `planes.editar`; implementación por router (`GET /planes/:id/routers`) y crear o editar la de un router `planes.editar`; nombres de los routers con `routers.ver` | Estática, `pendientesPanel.test.ts`, `e2e/pendientes-panel.spec.ts` |
| Plantillas | `/plantillas` | `plantillas.ver` | Nueva plantilla `plantillas.crear`; Editar `plantillas.editar` (sin él, el formulario se abre en solo lectura); reglas de promesas por canal en el mismo formulario | Rutas, Lectura (+ control admin), estática, `plantillas.test.ts`, `e2e/plantillas.spec.ts` |
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
| Usuarios | `/usuarios` | `usuarios.ver` | Nuevo usuario `usuarios.crear`; Editar (datos, contraseña, roles con alcance) `usuarios.editar`; Desactivar/Reactivar `usuarios.editar` (no se ofrece sobre uno mismo; la API responde 422 `autodesactivacion`); Asignar empresas `usuarios.asignar_empresas`; la lista de roles del formulario pide `roles.ver` (sin él la edición no toca los roles) y las de routers, zonas y cajas su `*.ver` (sin él se escribe el id) | Rutas, Lectura (+ control admin), estática, `usuariosAcl.test.ts`, `e2e/usuarios.spec.ts` |
| Roles y permisos | `/usuarios/roles` | `roles.ver` | Nuevo rol `roles.crear`; Editar `roles.editar` (sin él, solo lectura). Los roles base solo cambian su descripción (422 `rol_base`); catálogo de permisos (`GET /permisos`) con los roles que tienen cada uno | Rutas, Lectura (+ control admin), estática, `usuariosAcl.test.ts`, `e2e/usuarios.spec.ts` |
| Tokens de API | `/usuarios/tokens` | `tokens.ver` | Nuevo token `tokens.crear` (pide también `usuarios.ver` para elegir el usuario; recortar permisos pide `roles.ver`); el valor se ve una sola vez (`ValorUnaVezModal`, nunca en el navegador); Revocar `tokens.revocar` | Rutas, Lectura (+ control admin), estática, `usuariosAcl.test.ts`, `e2e/usuarios.spec.ts` |
| Plantillas de avisos | `/notificaciones` | `notificaciones.ver` | Plantillas por evento y canal, recordatorios y registro de envíos (lectura); Editar plantilla y recordatorio `notificaciones.editar`; filtro por cliente `clientes.ver` | Estática, `pendientesPanel.test.ts`, `e2e/pendientes-panel.spec.ts` |
| Cuentas bancarias | `/configuracion/cuentas-bancarias` | `cuentas_bancarias.ver` | Nueva y Editar `cuentas_bancarias.editar` | Rutas, Lectura (+ control admin), `cuentasBancarias.test.ts` |
| Empresa | `/configuracion/empresa` | `empresa.ver` | Guardar `empresa.editar` (formulario deshabilitado sin él) | Rutas, Lectura, `empresaDocumentos.test.ts` |
| Plantilla del aviso | `/configuracion/aviso-cobro` | `documentos.ver` | Guardar y vista previa `documentos.editar` | Rutas, `empresaDocumentos.test.ts` |
| Sin permiso | `/sin-permiso` | — | Ninguna | `aclRoles.test.ts` |
| Login | `/login` | pública | Entrar | `permisos.spec.ts` |

## Huecos encontrados y corregidos (semana 3)

1. **Cerrar sesión no revocaba el token.** `logout()` solo borraba la cookie; el token seguía valiendo hasta 12 h. Ahora llama `POST /auth/logout` (queda `auth.logout` en la bitácora); desde la 2.ª tanda la API además borra la cookie `HttpOnly`.
2. **Enlaces a secciones sin permiso** (28): nombre del cliente en facturas, pagos, promesas, comprobantes y servicios; indicadores del tablero; "libro diario" en egresos; volver a la ficha al guardar o cancelar en alta y edición de cliente y servicio. Ahora pasan por `enlace()` / `destinoPermitido()`.
3. **Llamadas a la API sin el permiso del endpoint** (11): búsqueda del nombre del cliente del filtro (`clientes.ver`) en 7 pantallas, servicios del cliente en facturas y en el simulador (`servicios.ver`), leer el cliente al editarlo. Sin el permiso no se llaman; el buscador de clientes queda deshabilitado con el motivo.

Los roles base tienen todos `clientes.ver` y `servicios.ver`, así que 2 y 3 afectaban solo a roles a la medida; igual dejaban ver un 403 crudo o un enlace a `/sin-permiso`.

## Sesión: cookie `HttpOnly` y CSRF (semana 3, 2.ª tanda)

Contrato: `.claude/integration/contratos/sesion-panel.md` (A1). Decisión del PM: la opción más segura sin cambiar el flujo.

| Pieza | Dónde | Qué hace |
| --- | --- | --- |
| Login | `useAuth().login()` → `POST /api/v1/auth/sesion` | La API pone la cookie `argos_sesion` (`HttpOnly`, `SameSite=Strict`, `Path=/api`, `Secure` salvo `PANEL_COOKIE_SEGURA=false` en desarrollo por IP). El cuerpo trae `usuario`, `csrf`, `expira_en` y `expira_max_en`; **nunca el token** |
| Token | — | El panel **no guarda ningún token**: ni cookie legible, ni `localStorage`, ni estado. La cookie vieja `argos_token` se borra al arrancar (`app/plugins/api.ts`) |
| `csrf` | `useCsrf()` (`useState`, solo en memoria) | Va en `X-CSRF-Token` en POST, PUT y DELETE (`createApiClient({ credentials: 'include', getCsrf })`). Tras recargar la página se recupera con `GET /me`, que con la cookie trae `csrf` |
| Peticiones | `app/plugins/api.ts` | `credentials: 'include'`, sin `Authorization` |
| Ruta protegida | `app/middleware/01.auth.global.ts` | Sin usuario cargado pregunta `GET /me`; con 401 → `/login?redirect=` (igual que antes) |
| Renovación | API (`contratos/sesion-panel.md` §4) | La sesión se renueva sola mientras se usa: vence tras 12 h sin peticiones y, aunque se use, a las 72 h del login (`expira_max_en`). La API reemite la cookie y el `csrf` no cambia; el panel no hace nada. Cuando faltan menos de 15 min para el tope, un toast discreto (`AvisoTopeSesion.vue`): "Tu sesión terminará pronto; guarda tu trabajo" |
| Sesión vencida (401 `sesion_expirada`) | `app/plugins/sesion.ts` + `SesionBloqueo.vue` | Con el usuario en memoria se abre la **ventana de bloqueo**: `UModal` de pantalla completa que no se cierra con Esc ni clic fuera; la página sigue montada debajo (filtros, formularios, borradores). Muestra nombre y correo de la sesión y solo pide la contraseña. "Desbloquear" llama `POST /auth/sesion` con el mismo correo, guarda `csrf` y `expira_*` y repite **una vez** cada petición que falló (las que estaban en vuelo esperan en cola, también los 401 que lleguen mientras está bloqueada). Credenciales malas: el error en la ventana; 429: cuántos segundos esperar (`Retry-After` o el `detail`). Si la API devuelve otro usuario: logout y al login. "No soy yo / Salir": logout, `/login` y el estado de la app vacío (`clearNuxtState`); las peticiones en cola devuelven su 401 |
| Otro 401 | `app/plugins/sesion.ts` | Sin `sesion_expirada` (token revocado por logout, usuario desactivado, sin cookie) o sin usuario en memoria (tras recargar la página): limpia la sesión local y vuelve a `/login?redirect=` |
| 403 `csrf_invalido` | `app/plugins/sesion.ts` | No es un 403 de permisos: recarga el `csrf` con `GET /me` y repite la petición **una vez**; si `/me` ya no tiene sesión, a `/login` |
| Logout | `useAuth().logout()` → `POST /api/v1/auth/logout` con `X-CSRF-Token` | La API revoca el token y borra la cookie; con la sesión ya vencida (401) se sale igual |
| CORS | `CORS_ORIGINS` de `apps/api` | Debe incluir el origen exacto del panel (con credenciales no se acepta `*`). Panel y API en el mismo sitio (mismo host, otro puerto) para que la cookie `SameSite=Strict` viaje |

**XSS:** un script inyectado ya no puede leer ni robar la sesión (la cookie es `HttpOnly`); solo podría actuar mientras la página está abierta, con el `csrf` en memoria. El panel no usa `v-html` con datos de la API (la vista previa del aviso es un PDF en `iframe` por `blob:`).

**CSRF:** `SameSite=Strict` impide que la cookie viaje desde otro sitio; además la API exige `X-CSRF-Token` (HMAC ligado a la sesión) en métodos no seguros y comprueba `Origin`.

### Cómo se probó

| Prueba | Qué comprueba |
| --- | --- |
| `tests/nuxt/sesionPanel.test.ts` | Login por `POST /auth/sesion` sin token legible; POST con `X-CSRF-Token` y 403 `csrf_invalido` sin él; reintento con el `csrf` de `GET /me`; recargar recupera el `csrf`; 401 limpia la sesión; logout revoca y borra la cookie. Los fixtures simulan la cookie (`bd.sesion`) y el CSRF (`fixtures/index.ts`) |
| Flujo contra la API real (semana 3, 2.ª tanda) | Sin sesión `/planes` → `/login?redirect=`; credenciales malas; login vuelve a `/planes`; cookie `argos_sesion` `HttpOnly`/`Strict`/`Path=/api` y ningún token en `document.cookie`, `localStorage` ni `sessionStorage`; `POST /planes` y la vista previa con `X-CSRF-Token` y sin `Authorization`; recargar mantiene la sesión y un `PUT /routers/:id` funciona; sin la cookie → `/login`; logout con `X-CSRF-Token` borra la cookie y la cookie vieja da 401 |
| Playwright (5 flujos, 1280 y 390) | El login de cada flujo pasa por `POST /auth/sesion` en modo fixtures |

## Token: historia

- **Hasta la semana 3 (1.ª tanda):** cookie `argos_token` escrita por el panel (`useCookie`, `SameSite=Lax`, 12 h) y `Authorization: Bearer`. Un XSS podía leerla. Reemplazada por la sesión de arriba.
- Los tokens de API, agentes de IA, `aaa`/`coa`, pruebas y scripts siguen con `Authorization: Bearer` (`POST /auth/login`), sin cambios.
- **Tokens de API desde el panel (tarea 9, `/usuarios/tokens`):** `POST /tokens` devuelve el valor en claro una sola vez; el panel lo muestra en `ValorUnaVezModal` con «Copiar» y lo olvida al cerrar (no va a cookies, `localStorage` ni estado). La lista nunca trae el valor (la API guarda su sha256). Revocar es inmediato e idempotente; desactivar al usuario también apaga sus tokens (`auth_middleware` exige usuario activo).
