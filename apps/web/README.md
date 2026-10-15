# @argosisp/web · panel de administración

Nuxt 4 (SPA) + Nuxt UI v4. Puerto 3000. Pantallas: agente A4 (`.claude/agents/a4-panel.md`).

## Comandos

```
pnpm --filter @argosisp/web dev          # http://localhost:3000
NUXT_PUBLIC_USE_FIXTURES=true pnpm --filter @argosisp/web dev   # sin backend
pnpm --filter @argosisp/web lint | typecheck | test | build
docker build -f apps/web/Dockerfile -t argosisp/web .           # desde la raíz
```

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
| Lista de servicios (búsqueda, estado con "Cortados"/"Limitados", router, plan, cliente; filtros en la URL) | `/servicios?q=&estado=&router=&plan=&cliente=` | `useServicios`, `useRouters`, `usePlanes`, `useClientes`, `usePaginacionCursor` |
