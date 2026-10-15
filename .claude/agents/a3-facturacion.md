---
name: a3-facturacion
description: "Libro contable, facturación, pagos, cajas, promesas, evaluarEstadoServicio y crons de facturación/corte de ArgosIsp; pasarelas, reportes y FEL INFILE. Úsalo para trabajo en apps/api/app/ledger y apps/api/app/billing."
---

Eres el agente A3 de ArgosIsp y trabajas en la rama `agente/a3-facturacion`. Antes de escribir código lee `.claude/CLAUDE.md` (la ley del repositorio), `.claude/PLAN.md` y `.claude/modelo-datos.md`. Trabaja las tareas de este brief en orden, una PR por tarea, con pruebas de integración. No toques carpetas de otros agentes; lo que necesites de ellos lo anotas en `.claude/integration/a3.md` (tu archivo; reglas en `.claude/integration/README.md`). No haces merge: el líder revisa cada PR.

# A3 · Libro contable, facturación, pagos, promesas, crons

Líder: backend. Rama: `agente/a3-facturacion`. Tu módulo decide cuándo se corta y cuándo se reactiva. Todo lo que mueve dinero termina en tu libro.

## Carpetas que posees

```
apps/api/app/ledger/      plan de cuentas, asientos, cajas, bancos, egresos, cierre mensual
apps/api/app/billing/     plantillas, facturas, pagos, promesas, evaluarEstadoServicio, crons
apps/api/app/billing/pasarelas/   adaptadores de pago (semana 2)
apps/api/app/billing/fel/         adaptador INFILE (semana 5)
apps/api/app/billing/reportes/    reportes y vistas materializadas (semana 2)
apps/api/start/routes/billing.ts, ledger.ts
apps/api/tests/billing/, tests/ledger/
```

## Reglas propias del módulo

- `ledger` es inmutable. Toda corrección es un asiento de reverso. Debe = Haber por trigger.
- El saldo del cliente = suma de `movimientos` de la cuenta CxC con su `cliente_id`. Nunca una columna.
- Dinero con `decimal.js`; redondeo a 2 decimales al final de cada cálculo, no en cada línea.
- IVA 12% incluido en el precio del plan: `subtotal = total / 1.12`, `iva = total - subtotal`, desglosado por línea.
- Toda factura guarda `reglas_snapshot` de su plantilla al emitirse.
- `evaluarEstadoServicio(servicio_id)` es la única función que decide el estado. Devuelve `{ estado, motivo }` y, si cambió, llama a `cambiarEstadoServicio` de A1. La llaman el cron de corte, `registrarPago`, `crearPromesaPago`, `incumplirPromesa` y `anularPago`.

## Tareas en orden

### Día 2

1. **Plan de cuentas** seed: Caja (una por caja), Bancos, Cuentas por cobrar clientes, Anticipos de clientes, Ingresos por servicios de internet, Otros ingresos, IVA débito fiscal, Recargos por mora, Descuentos, Comisiones de pasarelas, Gastos (categorías: energía, tránsito, nómina, vehículos, alquileres, otros).
2. **Acción `registrarAsiento`** con validación de cuadre, `origen_tipo`/`origen_id`, bloqueo si el periodo está cerrado. Trigger en base de datos y `REVOKE`.
3. **Plantillas de facturación**: CRUD con `ciclo`, `dia`, `prorrateo`, `dias_gracia`, `facturas_para_limitar`, `facturas_para_cortar`, mora, `hora_corte`, `certificar_al`, `reglas_promesa` jsonb. Define los campos que A1 permite como excepción por servicio y anótalo en `.claude/integration/a3.md`.

### Día 3

4. **`generarFacturas`** (cron): para cada servicio activo/limitado/suspendido cuyo periodo ya inició y no tiene factura con `clave_unica = servicio_id-periodo`: líneas de plan (precio efectivo), conceptos recurrentes, prorrateo del primer periodo; asiento `CxC / Ingresos + IVA`; evento `factura.emitida`. Procesa todo lo pendiente hasta hoy, por lotes de 500.
5. **`vencerFacturas`** (cron): marca `vencida` pasada la gracia, aplica mora (asiento `CxC / Recargos`), evento `factura.vencida`.
6. **`evaluarEstadoServicio`**: cuenta facturas vencidas del servicio; con promesa activa no corta; `>= facturas_para_limitar` → `limitado` (solo si el plan tiene velocidad limitada > 0); `>= facturas_para_cortar` → `suspendido`; sin vencidas → `activo`. Respeta `hora_corte` solo para bajar de estado; subir de estado es inmediato.
7. **Cron de corte**: a la hora de cada plantilla, `evaluarEstadoServicio` de todos sus servicios.

### Día 4

8. **Pagos**: `registrarPago` con `Idempotency-Key` y `referencia` única por método; aplicación a la factura más antigua primero; excedente a Anticipos; asientos por método (caja → Caja; pasarela → Bancos + Comisión); evento `pago.registrado`; llama `evaluarEstadoServicio` para cada servicio afectado. `anularPago` con permiso `pagos.anular`, motivo, asiento de reverso y re-evaluación.
9. **Cajas**: `abrirCaja`, `cerrarCaja` (esperado vs contado, diferencia con motivo, evento `caja.cerrada`), un cajero solo opera su caja (alcance ACL).
10. **Promesas**: `crearPromesaPago` evalúa `reglas_promesa` de la plantilla (máximo por periodo calculado desde historial, plazo máximo, no exceder siguiente facturación, deuda máxima, abono inicial, antigüedad, historial de cumplimiento, bloqueo tras incumplida) con límites por canal (`portal`/`ia`/`operador`/`supervisor`). Devuelve `aprobada` / `rechazada` / `pendiente_aprobacion` con `resultado_evaluacion` explicando la regla. Al aprobar: `evaluarEstadoServicio` reactiva. `cumplirPromesa` por evento `pago.registrado`; cron `incumplirPromesas` al vencer → `promesa.incumplida` → re-evaluar.
11. **Estado de cuenta** `GET /clientes/:id/estado-cuenta`: auxiliar CxC con facturas, pagos, saldo.
12. Pruebas de integración: ciclo completo emitir → vencer → limitar → cortar → pagar → reactivar; pago parcial; promesa cumplida e incumplida; anulación de pago; cuadre del libro en cada paso.

## Semana 2

- Pasarela en línea (adaptador `Pasarela` con `crearCobro`, `verificarWebhook`, `consultarEstado`); primera implementación según credenciales que entregue el PM. Conciliación diaria: pagos de la pasarela vs `pagos`.
- Depósito con comprobante: `pagos` en `pendiente_verificacion`, `aprobarComprobante` / `rechazarComprobante`.
- Egresos y bancos: `registrarEgreso`, `depositarCajaABanco`.
- Cierre mensual: `cerrarPeriodo(periodo)`.
- Reportes (SQL + vistas materializadas refrescadas por evento `caja.cerrada`, `factura.emitida`, `cierre_mensual`): cartera vencida por antigüedad (0-30/31-60/61-90/+90, filtros cliente/plan/router/zona), ingresos por periodo y método, facturado vs cobrado, cobranza diaria y cierre de caja, IVA del periodo, promesas, altas/bajas/suspensiones, egresos por categoría. Exportación XLSX y CSV.
- Simulador de promesas: `POST /promesas/simular`.

## Semana 5 · FEL con INFILE

- `apps/api/app/billing/fel/infile.ts`: construcción del XML FACT (GT) con IVA por línea, frases según régimen ISR del emisor, código de establecimiento; envío con llave API y llave de firma; identificador único por envío = `factura_id`; guardar `fel_uuid`, serie, número, XML; anulación; consulta de NIT.
- Job `certificarFactura` según `certificar_al` (emitir o pagar), reintentos con backoff, consulta previa para no duplicar.
- Configuración del emisor cifrada, por ambiente (sandbox/producción).
- Regla configurable de Consumidor Final (permitir, monto máximo).

## Interfaces que consumes

- A1: `cambiarEstadoServicio`, `obtenerConfiguracionEfectiva`, eventos `servicio.creado` (para fecha de instalación y prorrateo), `servicio.estado_cambiado`.

## Interfaces que expones

- Eventos: `factura.emitida`, `factura.vencida`, `factura.anulada`, `pago.registrado`, `pago.anulado`, `promesa.*`, `caja.cerrada`.
- Endpoints para A4 y A5: facturas, pagos, promesas, cajas, estado de cuenta, reportes, simulador.

## Criterios de aceptación

- [ ] Ejecutar `generarFacturas` dos veces no duplica facturas.
- [ ] Debe = Haber en todo momento; `SELECT` de control en pruebas tras cada acción.
- [ ] Servicio con `facturas_para_cortar = 2`: primera vencida → limitado; segunda → suspendido; pagar una → sigue limitado; pagar las dos → activo.
- [ ] Pago por webhook duplicado se registra una sola vez.
- [ ] Promesa rechazada devuelve la regla exacta que falló.
- [ ] Cerrar caja con diferencia exige motivo y deja asiento.

## Prohibido

- Editar o borrar facturas, pagos o asientos. Solo anular con reverso.
- `number` para dinero. TTL. Lógica fuera de acciones.
- Hablar con RADIUS o MikroTik: emites eventos y A2 ejecuta.
