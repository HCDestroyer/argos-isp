import type { Schema } from '@argosisp/contracts'

/**
 * Resumen del dashboard como lo arma `GET /dashboard/resumen` (vistas que el `billing-worker`
 * refresca por evento). Los montos son string con dos decimales; `series` trae 12 meses con el
 * actual al final, también los meses sin movimientos (en cero).
 */
export const resumenDashboard: Schema<'ResumenDashboard'> = {
    servicios: { activos: 412, limitados: 18, suspendidos: 37, retirados: 9 },
    clientes: { activos: 398, limitados: 17, cortados: 35 },
    mes: { periodo: '2026-10', facturado: '98450.00', cobrado: '61230.75', cobranza_pct: 62.19 },
    cartera_vencida: { monto: '15840.50', facturas: 64, clientes: 41, pendiente_total: '52059.75' },
    hoy: { fecha: '2026-10-16', cobrado: '4380.00', pagos: 19 },
    promesas_activas: { cantidad: 7, monto: '2135.00' },
    series: [
        { periodo: '2025-11', facturado: '0.00', cobrado: '0.00', facturas: 0, pagos: 0 },
        { periodo: '2025-12', facturado: '71200.00', cobrado: '66410.50', facturas: 402, pagos: 371 },
        { periodo: '2026-01', facturado: '74350.00', cobrado: '70125.00', facturas: 418, pagos: 392 },
        { periodo: '2026-02', facturado: '76900.00', cobrado: '71880.25', facturas: 431, pagos: 401 },
        { periodo: '2026-03', facturado: '80125.00', cobrado: '77940.00', facturas: 447, pagos: 425 },
        { periodo: '2026-04', facturado: '82410.00', cobrado: '79002.50', facturas: 455, pagos: 433 },
        { periodo: '2026-05', facturado: '85600.00', cobrado: '80311.75', facturas: 469, pagos: 440 },
        { periodo: '2026-06', facturado: '88975.00', cobrado: '85420.00', facturas: 481, pagos: 452 },
        { periodo: '2026-07', facturado: '91230.00', cobrado: '86115.40', facturas: 490, pagos: 461 },
        { periodo: '2026-08', facturado: '93880.00', cobrado: '90204.10', facturas: 502, pagos: 477 },
        { periodo: '2026-09', facturado: '96120.00', cobrado: '91980.65', facturas: 511, pagos: 486 },
        { periodo: '2026-10', facturado: '98450.00', cobrado: '61230.75', facturas: 520, pagos: 318 },
    ],
    actualizado_en: {
        resumen_mensual: '2026-10-16T17:42:10.000Z',
        resumen_cobros_diarios: '2026-10-16T17:42:11.000Z',
        resumen_servicios: '2026-10-16T17:40:02.000Z',
        resumen_cartera: '2026-10-16T17:42:10.000Z',
        resumen_promesas: '2026-10-16T17:31:45.000Z',
    },
}
