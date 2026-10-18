# @argosisp/web · panel de administración

Nuxt 4 (SPA) + Nuxt UI v4. Puerto 3000. Pantallas: agente A4 (`.claude/agents/a4-panel.md`).

Identidad visual "vidrio y luz" (skill `horus-identity`, marca ArgosIsp): tokens, materiales,
luz, mapeo de estados (color + icono + texto), gráficas y tipografía en [`docs/identidad.md`](docs/identidad.md).

## Comandos

```
pnpm --filter @argosisp/web dev          # http://localhost:3000
NUXT_PUBLIC_USE_FIXTURES=true pnpm --filter @argosisp/web dev   # sin backend
pnpm --filter @argosisp/web lint | typecheck | test | build
docker build -f apps/web/Dockerfile -t argosisp/web .           # desde la raíz
```

Pruebas de flujo (Playwright, `tests/e2e/*.spec.ts`; los navegadores salen de
`PLAYWRIGHT_BROWSERS_PATH`, no se descargan): `pnpm --filter @argosisp/web test:e2e` levanta el
panel en modo fixtures en el puerto 3150 (`PW_PUERTO`), o usa `PW_BASE_URL` para uno ya levantado.
Las 5 obligatorias, a 1280 y 390 px: 1 `permisos.spec.ts` (el cajero no ve Routers y `/routers` lo manda a `/sin-permiso`), 2 `alta-cliente-servicio.spec.ts`, 3 `cobro-reactivacion.spec.ts`, 4 `promesa.spec.ts` (resultado de la evaluación) y 5 `cierre-caja.spec.ts` (faltante con motivo). Navegan por el menú (`tests/e2e/ayudas.ts`), sin `page.goto` después de entrar. Además: `menu.spec.ts` (grupos, barra compacta, Ctrl+K) y `accesibilidad.spec.ts` (axe en claro y oscuro y foco visible; `@axe-core/playwright`).

Variables en `.env.example`. En modo fixtures: `admin@argos.test` (todo) o `cajero@argos.test`
(los permisos de `ROLES_BASE.cajero` de `apps/api/app/core/permisos.ts`: sin routers, plantillas,
bitácora, libro ni usuarios), cualquier contraseña.

Fallas simuladas en modo fixtures (para ver que una pantalla muestra el error y no datos inventados):
`simularFalla('GET /api/v1/pagos', 501)` en pruebas, o en el navegador
`localStorage.setItem('argos_fixtures_fallas', '{"GET /api/v1/pagos": 501}')`.

## Lo que deja el día 1

| Pieza | Dónde |
| --- | --- |
| Cliente HTTP único (`createApiClient` de `@argosisp/contracts`) | `app/plugins/api.ts`, `useApi()` |
| Sesión: cookie `HttpOnly` `argos_sesion` de la API + `csrf` en memoria (`contratos/sesion-panel.md`), `login`, `logout`, `cargarMe`; 401 y 403 `csrf_invalido` en `plugins/sesion.ts` | `useAuth()`, `useCsrf()` |
| Permisos: `puede('servicios.suspender')`, `puedeAlguno`, `puedeTodos` | `usePermisos()` |
| Middleware global: sin sesión → `/login`; `definePageMeta({ permiso })` → `/sin-permiso` | `app/middleware/` |
| Menú lateral filtrado por permiso | `app/utils/navegacion.ts`, `app/layouts/default.vue` |
| Formato: `formatearFecha`, `formatearFechaHora` (America/Guatemala), `formatearQuetzales('1234.5')` → `Q 1,234.50` | `app/utils/formato.ts` |
| Estados del servicio con colores fijos | `EstadoServicioBadge`, `app/utils/estadoServicio.ts` |
| Estructura de página (`UDashboardPanel` + navbar) | `PanelPagina` |
| Fixtures (`fetch` falso para el cliente tipado) | `fixtures/index.ts`, `app/utils/fetchFixtures.ts` |

## Reglas para pantallas nuevas

- Página: `pages/<seccion>/...` con `definePageMeta({ permiso: '<recurso>.ver' })` y `<PanelPagina>`.
  Quita `<SeccionPendiente>` cuando la pantalla exista.
- Datos: un composable por recurso (`useClientes`) que llama `useApi()`. Tipos desde
  `@argosisp/contracts` (`Schema<'Cliente'>`), nunca interfaces a mano.
- Dinero: siempre strings decimales de la API; si hay que sumar, `decimal.js`. Mostrar con `formatearQuetzales`.
- Si un endpoint aún devuelve 501, agrega sus datos en `fixtures/<recurso>/datos.ts` (tipados con
  `Schema<'X'>`) y sus rutas en `fixtures/<recurso>/rutas.ts` (`'GET /api/v1/clientes/:id'`, con
  `conPermiso('clientes.ver', ...)`), y regístralas en `fixtures/index.ts`. Las altas y ediciones
  viven en memoria en `fixtures/bd.ts`; las pruebas llaman `reiniciarFixtures()`.
- Llamadas a la API desde composables con `resolver(api.GET(...))` → `Resultado<T>` (`ok` + `data`
  o `problema`). Listas con cursor: `usePaginacionCursor` + `<PaginacionCursor>`; errores con
  `<ProblemaAlerta>`; 422 al formulario con `erroresDeFormulario(problema)`.
- ESLint prohíbe `<button>`, `<input>`, `<select>`, `<textarea>`, `<table>` crudos y `any`; indentación de 4.

## Pantallas

| Pantalla | Ruta | Composables |
| --- | --- | --- |
| 1 · Lista de clientes (búsqueda, zona) | `/clientes` | `useClientes`, `useZonas`, `usePaginacionCursor` |
| 2 · Ficha de cliente (datos, fiscales, servicios, estado de cuenta, línea de tiempo) | `/clientes/:id?tab=` | `useClientes`, `useServicios`, `usePlanes`, `useRouters`, `useBitacora` |
| 3 · Alta y edición de cliente (zod espejo de `crearClienteValidator`, Idempotency-Key, 409 por versión) | `/clientes/nuevo`, `/clientes/:id/editar` | `useClientes`, `useZonas` |
| 4 · Alta de servicio (cliente → router → plan del router → IPv4 → IPv6 → credenciales PPP → plantilla y excepciones) | `/servicios/nuevo?cliente=` | `useServicios`, `useRouters`, `usePlantillas`, `useClientes` |
| 5 · Ficha de servicio: plan, red (IPv4/IPv6), credenciales PPPoE bajo demanda (`servicios.ver_credenciales`), sesión activa, acciones con motivo (suspender, reactivar, limitar, quitar límite, desconectar, retirar), historial de asignaciones (`GET /servicios/:id/asignaciones`), promesas e historial | `/servicios/:id` | `useServicios`, `useSesiones`, `useBitacora`, `usePlanes`, `useRouters`, `usePlantillas` |
| Cobro rápido (pedido del PM): cliente → pendiente (`GET /clientes/:id/estado-cuenta`) y servicios → monto (vencido por defecto), método del enum del contrato, caja con turno abierto, referencia (obligatoria salvo efectivo), nota → `POST /pagos` con `Idempotency-Key` → recibo imprimible (ticket 80 mm) y seguimiento de la reactivación cada 3 s hasta 30 s. Enter registra, Esc limpia | `/cobro?cliente=` (menú "Cobrar", `pagos.registrar`) | `usePagos`, `useCajas`, `useClientes`, `useServicios`, `useSeguimientoReactivacion` |
| Lista de servicios (búsqueda, estado con "Cortados"/"Limitados", router, plan, cliente; filtros en la URL) | `/servicios?q=&estado=&router=&plan=&cliente=` | `useServicios`, `useRouters`, `usePlanes`, `useClientes`, `usePaginacionCursor` |
| 10 · Facturas: filtros del contrato (estado, cliente, servicio, periodo; `tipo` pedido a A3), detalle con líneas, montos, FEL, pagos aplicados y asientos del libro (Debe/Haber con `decimal.js`), "Anular" con motivo (`facturas.anular`). Enlaces desde el estado de cuenta del cliente | `/facturas?estado=&cliente=&servicio=&periodo=`, `/facturas/:id` | `useFacturas`, `usePagos`, `useLibro`, `useNombresClientes` |
| 11 · Pagos: filtros (cliente, método, estado, caja, desde/hasta en días de Guatemala), detalle con facturas pagadas, anticipo y asientos, "Anular pago" con motivo (`pagos.anular`). El cobro sigue en `/cobro` | `/pagos?cliente=&metodo=&estado=&caja=&desde=&hasta=`, `/pagos/:id` | `usePagos`, `useCajas`, `useLibro`, `useNombresClientes` |
| 12 · Caja: elegir caja (la del usuario por defecto), abrir turno con fondo inicial, cobros del turno, esperado provisional, cerrar con arqueo (contado escrito o por denominación, diferencia en vivo, motivo obligatorio si ≠ 0) e historial de turnos con faltantes y sobrantes | `/caja?caja=` | `useCajas`, `usePagos`, `useNombresClientes` |
| 13 · Promesas: lista con filtros (estado, cliente, servicio) y accesos a pendientes y activas, evaluación (decisión, regla y motivo) en cada fila, "Aprobar" para pendientes (`promesas.aprobar`); en la ficha del servicio "Promesa de pago" (`promesas.crear`, monto sugerido = pendiente del servicio) con el resultado de la evaluación visible y la lista de sus promesas | `/promesas?estado=&cliente=&servicio=`, `/servicios/:id` | `usePromesas`, `useServicios`, `useClientes`, `useNombresClientes` |
| 14 · Bitácora: acciones con filtros por actor, canal, acción, entidad (tipo e id), fechas (días de Guatemala enviados como UTC) y petición (`request_id`); detalle en panel lateral con entrada y resultado; pestaña "Historial de cambios" por entidad o petición (`GET /bitacora/cambios`) con `***` tal cual | `/bitacora?tab=&actor=&canal=&accion=&tipo=&entidad=&desde=&hasta=&peticion=` | `useBitacora`, `useUsuarios` |
| Cobro · elegir facturas (pedido del PM): casillas por factura pendiente (servicio, periodo, vencimiento, total, saldo; vencidas marcadas), vencidas marcadas por defecto, monto = suma de marcadas (editable), aviso de factura parcial o de excedente (otras facturas o saldo a favor) con `distribuirPago`, `facturas[]` en el orden de la pantalla y recibo con cada factura pagada | `/cobro?cliente=` | `usePagos`, `useClientes` |
| 15 · Libro: diario (asientos con movimientos, filtros por fecha contable, mes y origen, totales Debe/Haber de la página con `decimal.js` y si cuadra) y mayor (cuenta imputable, auxiliar por cliente en CxC y anticipos, saldo inicial, saldo acumulado por línea y saldo final). Egresos: sin endpoint todavía | `/libro?tab=&desde=&hasta=&origen=&cuenta=&cliente=` | `useLibro`, `useNombresClientes` |
| Semana 2 · Comprobantes de depósito (A3): pestañas pendientes/aprobados/rechazados, filtro por cliente, detalle con la foto o el PDF (`GET /comprobantes/:id/archivo` como `Blob`) junto a los datos declarados, "Aprobar" con facturas elegibles y vista previa del reparto (sin elegir, las del servicio del comprobante), "Rechazar" con motivo, servicio reactivado desde `pago.servicios[]` y contador de pendientes en el menú (`comprobantes.ver`/`aprobar`/`rechazar`) | `/comprobantes?estado=&cliente=`, `/comprobantes/:id` | `useComprobantes`, `useClientes`, `useServicios` |
| Semana 3 · Vista previa del cambio de modo de colas (A2): al pedir "Cambiar a …" en Routers · Velocidad, el `UModal` carga `GET /routers/:id/vista-previa-control?a=` y muestra servicios afectados, lotes, sesiones PPPoE a desconectar (advertencia en rojo si hay), la tabla por menú de RouterOS (crea, actualiza, borra) y los objetos en un desplegable. Sin vista previa (cargando o con error y "Reintentar") no se puede confirmar; un 409 al confirmar relee el router y la vista | `/routers` → Velocidad | `useRouters` (`vistaPreviaControl`), `RouterVistaPreviaControl` |
| Semana 3 · Migración de router (piloto, solo lectura): por router, servicios vigentes (PPPoE y WISP), con sesión PPPoE abierta, PPPoE sin sesión desde la fecha en que el router apunta al nuevo `aaa` (la escribe el operador, hora de Guatemala) con su lista, y errores de red de la bitácora (`routeros.*`, desconectar). Cada número solo con su lista leída completa; si no, error con "Reintentar", "sin permiso" o "falta un resumen en la API". `audit.red` no tiene endpoint: pedido a A2 | `/routers/migracion?router=&desde=` (botón "Migración" en Routers) | `useServicios`, `useSesiones`, `useBitacora`, `MigracionLectura`, `app/utils/migracion.ts` |
| Semana 3 · ACL por pantalla: checklist en `docs/seguridad/acl-panel.md`; `usePermisos().enlace()`, `puedeAbrir()` y `destinoPermitido()` para enlaces entre secciones; logout revoca el token (`POST /auth/logout`) | todas | `usePermisos`, `useAuth` |
| Multiempresa · selector de empresa activa (`contratos/multiempresa.md`): en la barra superior (en el teléfono, una fila debajo), con las `empresas[]` de `GET /me`; "Todas las empresas" solo con `alcance_global` (sin cabecera y `?empresas=todas` en cada GET del OpenAPI que lo acepta: `LISTAS_CONSOLIDABLES`, comparada con `openapi.json` en una prueba). Cada petición lleva `X-Empresa-Id` (`plugins/empresa.ts`); la elección se recuerda por usuario en `localStorage` y al cambiarla la página se vuelve a montar. Con una sola empresa no aparece | todas | `useEmpresaActiva`, `SelectorEmpresa` |
| Multiempresa · Empresas: lista con logo, NIT, régimen y estado; alta y edición (`UForm` espejo de `crearEmpresaValidator`, `version` y 409, `nit_duplicado` junto al NIT), logo con vista previa (PNG o SVG ≤ 512 KB, multipart) y desactivar con motivo (422 `empresa_principal`, `empresa_con_servicios`). Pestaña "Sugerencias": empresa sugerida por zona y por router | `/configuracion/empresas?tab=` | `useEmpresas`, `useZonas`, `useRouters` |
| Multiempresa · Usuarios: roles y empresas de cada usuario; "Asignar empresas" (`PUT /usuarios/:id/empresas`): alcance global (solo quien lo tiene) o al menos una empresa | `/usuarios` | `useUsuarios` |
| Multiempresa · Servicio: la empresa en la ficha y en la lista; "Cambiar empresa" (`POST /servicios/:id/cambiar-empresa`) con el 422 `servicio_con_saldo` explicado y enlace al cobro; en el alta, "Empresa que factura" sugerida por zona > router > empresa activa | `/servicios/:id`, `/servicios/nuevo` | `useServicios`, `useZonas` |
| Multiempresa · Ficha del cliente: servicios y avisos pendientes agrupados por empresa (la de cada servicio) con lo pendiente de cada una; el saldo total queda informativo. Cobro: "Un pago por empresa" antes de registrar cuando las facturas marcadas son de varias empresas | `/clientes/:id`, `/cobro` | `agruparPorEmpresa`, `repartoPorEmpresa` |
| Multiempresa · Cobro repartido: `POST /pagos` en efectivo con facturas de varias empresas devuelve `pagos[]` (uno por empresa, mismo `cobro_id`); el cobro los lista y el recibo `GET /cobros/:id` trae una sección por empresa con su marca y datos fiscales. 422 `caja_no_abierta` nombra la empresa y ofrece abrir caja; `cuenta_de_otra_empresa` y `pago_de_varias_empresas` se explican | `/cobro` | `usePagos().cobro`, `ReciboCobro` |
| Multiempresa · Alta de caja: "Nueva caja" (`POST /cajas`, `cajas.crear`) con nombre, empresa (la activa por defecto) y cajero opcional; 409 `caja_duplicada` junto al nombre. Cada tarjeta dice su empresa | `/caja` | `useCajas().crear`, `CajaCrearModal` |
| Multiempresa · Balance de saldos y estado de resultados: una sección por empresa (cuentas, totales, "Cuadra") y el total del grupo con "Todas" | `/libro?tab=balance`, `/libro?tab=resultados` | `useLibro().balance`, `useLibro().estadoResultados`, `LibroEstadoFinanciero` |
| Multiempresa · Reportes consolidados (columnas Empresa y Nombre de la empresa con "Todas") y bitácora con la empresa de cada acción ("Del grupo" si no es de ninguna) | `/reportes/:reporte`, `/bitacora` | `useReportes`, `useBitacora` |
| Multiempresa · Notificaciones: global y por empresa (hereda o propia), correo SMTP y Telegram con sus interruptores, avisos por tipo, secretos `***` (Reemplazar / Borrar / sin tocar no viaja) y "Enviar prueba" con el error real | `/configuracion/notificaciones?empresa=` | `useNotificaciones`, `CampoSecreto` |
| Fase 3 · Configuración → FEL (por empresa): certificador (INFILE; el falso solo en pruebas), ambiente y modo con `version` (409), credenciales de solo escritura por ambiente («Configuradas», campos visibles, «Probar» con su resultado), contingencia con motivo, `certificar_al` por plantilla; 422 `avisos_por_certificar` con la cuenta y `certificar_al_incompatible`. Aviso global (en `PanelPagina`) con la FEL desactivada o en contingencia | `/configuracion/fel` | `useFel`, `usePlantillas`, `FelCredencialesModal`, `FelCertificarAl`, `AvisoFel` |
| Fase 3 · DTE en factura, mora (NDEB) y nota de crédito (NCRE): estado con icono y texto, autorización, serie y número, intentos, error del certificador; reintentar (`fel.certificar`), certificar a mano, XML y PDF; anular en dos pasos (`facturas.anular` + `fel.anular`, anulación pendiente), sustituir (`facturas.sustituir`), nota por línea, anular la nota cuya NCRE rechazó la SAT (`facturas.anular_nota_credito`); `por_certificar` no es deuda | `/facturas/:id`, `/notas-credito/:id` | `useDte`, `useFacturas`, `useNotasCredito`, `DteDocumento`, `DteFicha`, `AnularFacturaModal`, `SustituirFacturaModal` |
| Fase 3 · Cola de DTE (consolidable): atajos por estado (pendientes, error temporal, rechazados, contingencia, anulación pendiente), filtros y detalle | `/dte?estado=&documento=`, `/dte/:id` | `useDte` |
| Fase 2 · Diarios y numeración (solo lectura, consolidable): código, tipo, cuenta por defecto y último número por año; detalle en panel lateral | `/libro?tab=diarios` | `useLibro().diarios`, `useLibro().verDiario`, `LibroDiarios` |
| Fase 2 · Integridad del libro: cadena de hash por empresa (verificada o la ruptura con su asiento, sellos, recalculados, sin sellar, primer y último hash) con rango por fecha o por sello; el cierre del mes explica 409 `ncre_sin_certificar` (con las notas) e `integridad_rota`; cada asiento muestra su diario y número | `/libro?tab=integridad` | `useLibro().integridad`, `LibroIntegridad`, `LibroCierres` |
| Fase 3 · Pedidos de A5 y A6: plantillas del aviso de cobro y de la nota de crédito; el editor avisa si una plantilla guardada no tiene el bloque FEL de la de fábrica (`GET /documentos/plantillas/:tipo/fabrica`), lo inserta, compara y restaura; PDF de la nota en su ficha; correo de contabilidad (lista separada por coma) en Notificaciones | `/configuracion/aviso-cobro`, `/configuracion/notificaciones` | `useDocumentos`, `useNotificaciones` |
