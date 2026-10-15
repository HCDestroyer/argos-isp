# A4 · Panel de administración (apps/web)

Líder: frontend. Rama: `agente/a4-panel`. Construyes contra `packages/contracts`; cuando un endpoint aún devuelve 501, usas fixtures en `apps/web/fixtures/` y lo anotas en `INTEGRATION.md`. Vas una pantalla por detrás del backend, nunca lo esperas.

## Carpetas que posees

```
apps/web/               todo, excepto lo que el líder dejó el día 1 (layout, login, cliente HTTP)
apps/web/fixtures/
apps/web/tests/         Vitest + @nuxt/test-utils para composables; Playwright para 5 flujos críticos
```

## Reglas propias

- Solo Nuxt UI. `UDashboardLayout`/`UDashboardPanel` para la estructura, `UTable` con paginación por cursor, `UForm` con esquema, `UModal`/`USlideover` para acciones, `UBadge` para estados, `UToast` para resultados.
- 4 espacios. Composable por recurso. Tipos desde contracts; nunca `any`.
- Cada acción de dominio es un botón que llama su endpoint explícito (`/servicios/:id/suspender`), con confirmación y motivo cuando el backend lo pide.
- Permisos: el layout recibe `GET /me` con permisos; cada botón y ruta se oculta o deshabilita según el permiso con el mismo nombre que la acción.
- Estados del servicio con colores fijos: activo verde, limitado ámbar, suspendido rojo, retirado gris.
- Fechas en `America/Guatemala`, montos en quetzales con dos decimales.
- Claro y oscuro; probado en 390px y 1280px.

## Pantallas en orden

### Día 2

1. Lista de clientes con búsqueda (nombre, NIT, teléfono, user PPP, IP) y filtros por estado y zona.
2. Ficha de cliente: datos, datos fiscales, servicios, estado de cuenta (pestañas), línea de tiempo (bitácora filtrada por cliente).
3. Alta y edición de cliente.
4. Alta de servicio: router → plan disponible en ese router → red IPv4 → modo IPv6 → credenciales PPP (generadas, editables) → plantilla de facturación y excepciones.

### Día 3

5. Ficha de servicio: estado, acciones (suspender, reactivar, limitar, quitar límite, retirar, desconectar sesión), sesión activa con IPv4 y prefijos IPv6, asignaciones e historial.
6. Routers: CRUD, redes IPv4, bloques y pools IPv6, estado de sesiones por router.
7. Planes: CRUD, global/por router, implementación por router con excepciones.
8. Plantillas de facturación: CRUD incluida la sección de reglas de promesas.
9. Usuarios, roles y permisos; tokens de API.

### Día 4

10. Facturas: lista con filtros y estado, detalle con líneas y asientos, anular con motivo.
11. Registrar pago: selección de cliente, facturas pendientes, método, referencia, nota; anular pago con permiso.
12. Caja: abrir turno, cobros del turno, cerrar con arqueo y diferencia.
13. Promesas: lista, crear con resultado de evaluación visible (regla que aplica), aprobar pendientes.
14. Bitácora: filtros por actor, canal, acción, entidad, fecha; detalle de entrada y resultado. Historial de cambios por entidad.
15. Libro diario y libro mayor: filtros por cuenta, periodo y origen; egresos.

## Semana 2

- Dashboard: ingresos cobrados vs facturado 12 meses, cartera vencida por antigüedad y tendencia, cobranza del día por método, servicios por estado, altas y bajas por mes, cumplimiento de promesas. Gráficas con `UChart` si existe en la versión de Nuxt UI del proyecto; si no, `vue-chartjs` con tema de Nuxt UI (anotar en la PR).
- Pantallas de reportes con filtros y exportación XLSX/CSV.
- Simulador de promesas dentro de la plantilla.
- Verificación de comprobantes de depósito (cola, aprobar, rechazar con motivo).
- Editor de plantillas de notificación por evento y canal, con vista previa de variables.
- Configuración de notificaciones (SMTP, bot de Telegram) y de egresos.

## Semana 5

- Configuración del emisor FEL y estado de certificación en cada factura (UUID, serie, número, error, reintentar).

## Pruebas obligatorias (Playwright)

1. Login y navegación por permiso (`cajero` no ve routers).
2. Alta de cliente y servicio.
3. Registrar pago y ver el servicio reactivarse.
4. Crear promesa y ver el resultado de evaluación.
5. Cierre de caja con diferencia.

## Interfaces que consumes

- Todo por `packages/contracts`. Si necesitas un endpoint que no existe, pídelo en `INTEGRATION.md` con el nombre del agente dueño (A1 o A3); no lo inventes en el frontend.

## Criterios de aceptación

- [ ] Ningún `<button>`, `<input>`, `<table>` crudo en el código.
- [ ] `pnpm typecheck` sin errores; cero `any`.
- [ ] Cada pantalla funciona con fixtures y con el backend real.
- [ ] Las 5 pruebas Playwright pasan en CI contra el backend en Docker.
