# Contrato: panel financiero, inicio por rol y reportes (A3 → A4, A6)

Versión 1 · 21 nov 2026 · decisiones del PM 2, 3, 4, 6, 7, 11 y 12 (`.claude/diseno/decisiones-pm.md`). Lo expone A3 (`apps/api/app/billing/panel/`, `apps/api/app/billing/reportes/`); las pantallas son de A4. Todo está en el OpenAPI (`packages/contracts`).

## 1. Reglas comunes

- **Multiempresa**: cada cifra es por empresa. La empresa activa (`X-Empresa-Id`) o las del alcance del usuario; `empresas=todas` solo con alcance global (403 si no). El total consolidado solo viene con `empresas=todas`.
- **Nunca ceros en lugar de un error**: cada sección del panel es un bloque `{ estado: ok | error | no_aplica, motivo, error, datos }` (como el tablero fiscal). Con `error`, `datos` es null y la pantalla muestra el problema con «Reintentar».
- **Sin permiso, la sección no aparece** (la clave no viene). No se manda vacía ni en cero.
- **Lenguaje** (decisión 11): las pantallas dicen «Ingreso mensual recurrente», «Bajas», «Ingreso promedio por servicio»; el término técnico (MRR, churn, ARPU) va en la ayuda «?» y en los títulos de columna exportados. Las descripciones del OpenAPI llevan la definición completa.

## 2. Panel financiero

### 2.1 `GET /panel-financiero?mes=YYYY-MM&empresas=todas`

Permiso `panel_financiero.ver` **sin alcance** por router, zona o caja (403 si el rol o el token lo recortan: el panel suma toda la empresa).

```
{ hoy, mes, generado_en,
  empresas: [{ empresa_id, empresa, ingresos?: Bloque, bajas?: Bloque, efectivo?: Bloque }],
  total: null | { ingresos?, bajas?, efectivo? } }
```

| Cifra | Definición |
| --- | --- |
| `ingresos.mrr` (ingreso mensual recurrente, MRR) | Por cada servicio `activo` o `limitado`: precio efectivo del plan (`costo_override` = precio especial pactado, o el precio del plan vigente; con plan temporal activo, el temporal) − mejora de lealtad (plan temporal `lealtad` sin precio especial: se cobra el original) + cargos recurrentes activos + adicionales `cobrado` vigentes y no bloqueados. **IVA incluido**. Sin mora, prorrateo, cargos únicos ni canjes de un solo mes. Desglose: `planes`, `descuentos`, `cargos_recurrentes`, `adicionales`, `servicios`. |
| `ingresos.arpu` (ingreso promedio por servicio, ARPU) | `mrr / servicios`, 2 decimales; null sin servicios. |
| `bajas.bajas` (bajas, churn) | Servicios `retirado`, o `suspendido` más de `dias_baja` días (60 de fábrica, por empresa), cuya fecha de baja cae en el mes y ya llegó. Fecha de baja: el retiro, o el inicio de la suspensión + `dias_baja` (la primera, si se retiró estando suspendido). **Un servicio reactivado deja de contar**, también en meses pasados. Desglose `retiros`, `suspendidos`. Historial: `servicio.estado_cambiado` en `audit.outbox`. |
| `bajas.base` | Servicios al inicio del mes = `vigentes` (activos, limitados y suspendidos que aún no son baja) + bajas desde el inicio del mes − altas desde el inicio del mes. |
| `bajas.tasa` (tasa de bajas) | `bajas / base × 100`, 2 decimales; null con base 0. |
| `efectivo.total` (efectivo disponible) | Saldo del libro (debe − haber) a hoy de las subcuentas de Cajas (`1.1.01.*`) y Bancos (`1.1.02.*`), con detalle por cuenta. Solo con `libro.ver`. Es el saldo del libro, no el del extracto bancario. |

### 2.2 `GET /panel-financiero/alertas`

`panel_financiero.ver`. Por empresa: `alertas[] { tipo, nivel: aviso | critico, titulo, detalle, datos }` y `errores[] { tipo, error }` (revisión que no se pudo hacer: nunca «sin alertas»). `revisados[]` dice qué tipos se miraron.

| Tipo | Permiso | Cuándo |
| --- | --- | --- |
| `integridad_libro` | `libro.ver` | Hay un `libro.integridad_rota` de la empresa (crítico). |
| `cierres_pendientes` | `libro.ver` | Meses terminados con asientos sin cerrar (aviso; crítico con dos o más). |
| `contingencia_fel` | `fiscal.ver` | FEL en contingencia (crítico). |
| `fel_desactivada` | `fiscal.ver` | FEL obligatoria y apagada (crítico). |
| `vencimientos_fiscales` | `fiscal.ver` | Obligaciones que vencen en 7 días o vencidas (crítico si alguna venció). |
| `limite_pequeno_contribuyente` | `fiscal.ver` | Facturado del año ≥ un umbral de `pc_alertas` (decisión 12: **80 % y 95 %** de fábrica, más 100 %). Aviso al primer umbral; crítico desde el segundo o al superar el límite. Panel del dueño. |

### 2.3 Ajustes

`GET /panel-financiero/ajustes` (`panel_financiero.ver`) y `PUT` (`panel_financiero.configurar`, versionada): `{ empresa_id, dias_baja, aviso_pc_activo, aviso_pc_umbrales, aviso_pc_umbrales_desde, aviso_pc_umbrales_nivel, aviso_pc_aplica, fabrica, version }`. Evento `panel_financiero.ajustes_cambiados`.

Aviso de pequeño contribuyente (decisión 12, 23 nov 2026): en el `PUT` cada campo es opcional (ausente = sin cambio). `aviso_pc_activo` (encendido de fábrica, en `billing.panel_ajustes`) apaga o enciende la alerta `limite_pequeno_contribuyente` de `GET /panel-financiero/alertas`; apagada, la empresa la lleva en `apagadas[]` (ni alerta ni error). Los umbrales siguen siendo una sola fuente: el parámetro fiscal `pc_alertas` de la empresa (80, 95 y 100 desde `gt-2026.5`), que también leen el tablero fiscal y `fiscal.limite_pc`. `aviso_pc_umbrales` distintos de los vigentes agregan un valor de `pc_alertas` vigente desde hoy con `fiscal.editar_parametros` anidada (403 sin ese permiso; 422 `localizacion_no_instalada`; 409 `vigencia_duplicada` si ya se cambiaron hoy); `motivo` opcional para su historial. `aviso_pc_umbrales` es null sin localización fiscal; `aviso_pc_aplica` dice si el régimen vigente es pequeño contribuyente. Apagar el aviso no detiene el evento `fiscal.limite_pc` del cron fiscal (sus avisos se configuran en notificaciones).

### 2.4 Reportes del panel

`GET /reportes/indicadores-financieros?mes=` (una fila por empresa; efectivo vacío sin `libro.ver`) y `GET /reportes/bajas?desde=&hasta=` (una fila por mes). Forma común de reportes, exportables y programables.

## 3. Exportación (decisión 7)

Toda ruta `/reportes/*` con la forma común acepta `formato=json|csv|xlsx|pdf`: cartera vencida, ingresos, facturado vs cobrado, cobranza diaria, cierres de caja, IVA, promesas, altas y bajas, egresos, bonificaciones, cuentas por pagar, indicadores financieros y bajas. El PDF (un solo generador, `pdfkit`) lleva logo de la empresa (PNG o SVG; en el consolidado, sin logo y «Consolidado de …»), nombre y NIT, título, filtros usados, «Generado el dd/MM/yyyy HH:mm (hora de Guatemala)», «Página N de M» y la fila de totales. Los libros legales siguen con su PDF con folio.

Pendiente: conciliación bancaria, balance, estado de resultados, inventario valorizado y lealtad no tienen la forma común; se exportarán cuando se pasen a ella.

## 4. Catálogo, favoritos y vistas

- `GET /reportes/catalogo` (`reportes.ver`): `[{ codigo, titulo, descripcion, ruta, permiso, compartible, formatos, favorito, vistas[] }]`, solo los que el usuario puede ver, favoritos primero.
- `PUT | DELETE /reportes/favoritos/:codigo` (idempotentes).
- `GET | POST /reportes/vistas`, `PUT | DELETE /reportes/vistas/:id`: `{ reporte, nombre, filtros, columnas? }`. Los filtros se validan con los del reporte (422 en `filtros.<campo>`); `formato` y `empresas` no se guardan. Nombre único por usuario y reporte (409 `vista_repetida`). Solo las propias (404 las ajenas).
- Son preferencias propias (como los accesos rápidos): acciones auditadas sin permiso propio del ACL. Evento `reportes.preferencias_cambiadas`.

## 5. Envíos programados (decisión 6)

- **Lista de correos externos aprobada por el admin**: `GET /reportes/correos-externos` (`reportes.programar_envio`), `POST` (`reportes.aprobar_correo_externo`, solo admin), `POST /reportes/correos-externos/:id/retirar` (`reportes.retirar_correo_externo`). Retirar no borra. La lista (`CorreoExternoReportesListado`, 23 nov 2026) trae además `aprobado_por_nombre`, `retirado_por_nombre`, `envios_programados` (envíos activos y en pausa que lo usan, de las empresas de la petición; consolidados solo con alcance global) y `envios_activos` (columna «Envíos» del tablero). El `POST` y el retiro siguen respondiendo `CorreoExternoReportes`.
- **Envíos**: `GET | POST /reportes/envios` (`reportes.programar_envio`), `GET /reportes/envios/:id`, `PUT /reportes/envios/:id` (`reportes.editar_envio`, versionada; `activo: false` pausa), `GET /reportes/envios/:id/corridas`. Campos: `reporte`, `nombre`, `filtros`, `formato` (`pdf`, `xlsx`, `csv`), `frecuencia` (`diaria`, `semanal` con `dia` 1–7, `mensual` con `dia` 1–28), `hora` (Guatemala), `destinatarios { usuarios[], correos_externos[] }`, `consolidado` (solo alcance global).
- **Reglas al programar**: quien programa debe poder ver el reporte (403); los usuarios existen y están activos; los correos están aprobados y activos; a un correo externo solo va un reporte **compartible** sin datos personales de clientes con esos filtros (422 `no_compartible`: p. ej. cartera agrupada por cliente o cualquier filtro `cliente_id`).
- **En cada envío** (cron `reportes` del worker de billing, cada 5 min, con lock; acción `reportes.ejecutar_envio` por envío): una corrida por envío y hora programada (`programado_para` único: repetir no reenvía); cada usuario se evalúa con su ACL, su alcance y su empresa de ese momento y recibe el reporte generado con **su** alcance (motivos de omisión: `usuario_inactivo`, `sin_permiso`, `alcance_parcial`, `sin_acceso_empresa`, `sin_correo`); a un correo externo, si sigue aprobado y el reporte es compartible, con el alcance de quien programó (`correo_retirado`, `no_compartible`, `sin_responsable`). Fallos: `sin_smtp`, `error_envio`. La próxima hora se calcula desde ahora (las perdidas no se mandan). Evento `reportes.envio_ejecutado`.
- El correo sale por el SMTP que configura notify (empresa, global o entorno) con el archivo adjunto.

## 6. Inicio por rol (decisión 2)

- `GET /inicio` (cualquier usuario): `{ inicio: panel_financiero | dia_a_dia, origen: usuario | rol | fabrica, rol, elegido, motivo, disponibles, version }`.
- Orden: la elección del usuario → la de sus roles (con varios, gana el panel financiero) → fábrica (`admin` y `dueno`/`dueño`: panel financiero; los demás: día a día). Sin `panel_financiero.ver` siempre día a día (`motivo: sin_permiso`).
- `PUT /inicio` (propio, `inicio.elegir`), `GET /inicio/roles` y `PUT /inicio/roles/:id` (`inicio.configurar_rol`), `PUT /inicio/usuarios/:id` (`inicio.configurar_usuario`). `inicio: null` vuelve al del rol o al de fábrica. 422 `inicio_sin_permiso` si se pide el panel sin el permiso. Evento `inicio.cambiado`.

## 7. Permisos

| Permiso | Roles de fábrica |
| --- | --- |
| `panel_financiero.ver` | admin, contabilidad, lectura (por ser `.ver`) |
| `panel_financiero.configurar` | admin, contabilidad |
| `reportes.programar_envio`, `reportes.editar_envio` | admin, contabilidad |
| `reportes.aprobar_correo_externo`, `reportes.retirar_correo_externo` | admin |
| `inicio.configurar_rol`, `inicio.configurar_usuario` | admin |
