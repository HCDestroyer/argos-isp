# @argosisp/web · panel de administración

Nuxt 4 (SPA) + Nuxt UI v4. Puerto 3000. Pantallas: agente A4 (`.claude/agents/a4-panel.md`).

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
Hoy: prueba obligatoria 3, "Registrar pago y ver el servicio reactivarse", a 1280 y 390 px.

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
| Sesión: token Bearer en la cookie `argos_token`, `login`, `logout`, `cargarMe` | `useAuth()` |
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
| 5 · Ficha de servicio: plan, red (IPv4/IPv6), credenciales PPPoE bajo demanda (`servicios.ver_credenciales`), sesión activa, acciones con motivo (suspender, reactivar, limitar, quitar límite, desconectar, retirar) e historial | `/servicios/:id` | `useServicios`, `useSesiones`, `useBitacora`, `usePlanes`, `useRouters`, `usePlantillas` |
| Cobro rápido (pedido del PM): cliente → pendiente (`GET /clientes/:id/estado-cuenta`) y servicios → monto (vencido por defecto), método del enum del contrato, caja con turno abierto, referencia (obligatoria salvo efectivo), nota → `POST /pagos` con `Idempotency-Key` → recibo imprimible (ticket 80 mm) y seguimiento de la reactivación cada 3 s hasta 30 s. Enter registra, Esc limpia | `/cobro?cliente=` (menú "Cobrar", `pagos.registrar`) | `usePagos`, `useCajas`, `useClientes`, `useServicios`, `useSeguimientoReactivacion` |
| Lista de servicios (búsqueda, estado con "Cortados"/"Limitados", router, plan, cliente; filtros en la URL) | `/servicios?q=&estado=&router=&plan=&cliente=` | `useServicios`, `useRouters`, `usePlanes`, `useClientes`, `usePaginacionCursor` |
| 10 · Facturas: filtros del contrato (estado, cliente, servicio, periodo; `tipo` pedido a A3), detalle con líneas, montos, FEL, pagos aplicados y asientos del libro (Debe/Haber con `decimal.js`), "Anular" con motivo (`facturas.anular`). Enlaces desde el estado de cuenta del cliente | `/facturas?estado=&cliente=&servicio=&periodo=`, `/facturas/:id` | `useFacturas`, `usePagos`, `useLibro`, `useNombresClientes` |
| 11 · Pagos: filtros (cliente, método, estado, caja, desde/hasta en días de Guatemala), detalle con facturas pagadas, anticipo y asientos, "Anular pago" con motivo (`pagos.anular`). El cobro sigue en `/cobro` | `/pagos?cliente=&metodo=&estado=&caja=&desde=&hasta=`, `/pagos/:id` | `usePagos`, `useCajas`, `useLibro`, `useNombresClientes` |
| 12 · Caja: elegir caja (la del usuario por defecto), abrir turno con fondo inicial, cobros del turno, esperado provisional, cerrar con arqueo (contado escrito o por denominación, diferencia en vivo, motivo obligatorio si ≠ 0) e historial de turnos con faltantes y sobrantes | `/caja?caja=` | `useCajas`, `usePagos`, `useNombresClientes` |
| 13 · Promesas: lista con filtros (estado, cliente, servicio) y accesos a pendientes y activas, evaluación (decisión, regla y motivo) en cada fila, "Aprobar" para pendientes (`promesas.aprobar`); en la ficha del servicio "Promesa de pago" (`promesas.crear`, monto sugerido = pendiente del servicio) con el resultado de la evaluación visible y la lista de sus promesas | `/promesas?estado=&cliente=&servicio=`, `/servicios/:id` | `usePromesas`, `useServicios`, `useClientes`, `useNombresClientes` |
| 14 · Bitácora: acciones con filtros por actor, canal, acción, entidad (tipo e id), fechas (días de Guatemala enviados como UTC) y petición (`request_id`); detalle en panel lateral con entrada y resultado; pestaña "Historial de cambios" por entidad o petición (`GET /bitacora/cambios`) con `***` tal cual | `/bitacora?tab=&actor=&canal=&accion=&tipo=&entidad=&desde=&hasta=&peticion=` | `useBitacora`, `useUsuarios` |
| Cobro · elegir facturas (pedido del PM): casillas por factura pendiente (servicio, periodo, vencimiento, total, saldo; vencidas marcadas), vencidas marcadas por defecto, monto = suma de marcadas (editable), aviso de factura parcial o de excedente (otras facturas o saldo a favor) con `distribuirPago`, `facturas[]` en el orden de la pantalla y recibo con cada factura pagada | `/cobro?cliente=` | `usePagos`, `useClientes` |
| 15 · Libro: diario (asientos con movimientos, filtros por fecha contable, mes y origen, totales Debe/Haber de la página con `decimal.js` y si cuadra) y mayor (cuenta imputable, auxiliar por cliente en CxC y anticipos, saldo inicial, saldo acumulado por línea y saldo final). Egresos: sin endpoint todavía | `/libro?tab=&desde=&hasta=&origen=&cuenta=&cliente=` | `useLibro`, `useNombresClientes` |
