/**
 * Registro del auditor contable: cómo se comporta cada tabla de `ledger` y `audit` (y los documentos
 * de `billing` que la regla 4 declara inmutables). Lo lee `libro.spec.ts`:
 *
 *  - Una tabla que existe en la base y no está aquí hace fallar la prueba con el texto exacto que
 *    hay que agregar. Cada fase que crea tablas en `ledger` o `audit` la clasifica aquí en su PR.
 *  - Las tablas del contrato que todavía no existen se ignoran hasta que la migración las cree; a
 *    partir de ahí se revisan solas.
 *
 * Fuente: regla 4 de `CLAUDE.md` y `contratos/localizacion-fiscal.md` (§3.4, §3.7, §10.3–§10.10).
 */

/** Solo inserción: trigger BEFORE UPDATE y DELETE por fila, y sin UPDATE/DELETE/TRUNCATE para la app. */
export const INMUTABLES: Record<string, string> = {
    // hoy
    'ledger.asientos': 'libro (regla 4)',
    'ledger.movimientos': 'libro (regla 4)',
    'ledger.cierres_mensuales': 'cierre de mes; reabrir agrega una reapertura',
    'ledger.reaperturas_mensuales': 'reapertura de mes',
    'ledger.egresos': 'egreso; anular agrega egresos_anulaciones',
    'ledger.egresos_anulaciones': 'anulación de egreso',
    'audit.acciones': 'auditoría (regla 9)',
    'audit.cambios': 'auditoría (regla 9)',
    'audit.red': 'auditoría (regla 9)',
    'audit.outbox': 'eventos; la app solo marca publicado_en e intentos (permiso por columna)',
    'billing.notas_credito': 'nota de crédito',
    'billing.cobros': 'cobro repartido',
    'billing.pagos_aplicaciones': 'aplicación de un pago a una factura (dinero)',
    'billing.saldos_iniciales_aplicaciones': 'aplicación de un saldo a favor importado (dinero)',
    // localización fiscal, fase 3 (FEL)
    'billing.notas_credito_lineas': 'nota de crédito por línea (§10.9)',
    'billing.sustituciones': 'sustitución de una factura (§10.9)',
    'fiscal.dte_intentos': 'bitácora ante el certificador (§3.6)',
    // localización fiscal §10.7 (numeración guardada)
    'ledger.asientos_numeros': 'número de diario asignado al insertar (§10.7)',
    'ledger.asientos_partidas': 'partida legal asignada al cerrar el mes (§10.7)',
    // §3.4 compras y retenciones
    'ledger.compras': 'compra (§3.4)',
    'ledger.compras_lineas': 'línea de compra (§3.4)',
    'ledger.compras_anulaciones': 'anulación de compra (§3.4)',
    'ledger.pagos_proveedores': 'pago a proveedor (§3.4)',
    'ledger.pagos_proveedores_anulaciones': 'anulación de pago a proveedor (§3.4)',
    'ledger.constancias_retencion': 'constancia de retención (§3.4)',
    // §3.7 y §10.4–§10.5 cierres y bloqueos
    'ledger.bloqueos': 'bloqueo; el vigente es la última fila (§3.7)',
    'ledger.bloqueos_excepciones': 'excepción de bloqueo; revocar = fila nueva (§10.4)',
    'ledger.cierres_anuales': 'cierre anual (§3.7)',
    'ledger.cierres_checks': 'lista de verificación de cierre (§10.5)',
    // §10.3 conciliación bancaria
    'ledger.extractos': 'extracto bancario (§10.3)',
    'ledger.extractos_lineas': 'línea de extracto (§10.3)',
    'ledger.conciliaciones': 'conciliación; deshacer = conciliaciones_anulaciones (§10.3)',
    'ledger.conciliaciones_anulaciones': 'anulación de conciliación (§10.3)',
    // fase 4 (A3): cobros por liquidar (§10.3)
    'ledger.liquidaciones_cobro': 'liquidación de un proveedor de cobro (§10.3)',
    'ledger.liquidaciones_pagos': 'pago o contracargo incluido en una liquidación (§10.3)',
    'ledger.depositos': 'depósito de caja a banco (§10.3)',
    'ledger.traslados': 'traslado entre cuentas propias (§10.3)',
    'ledger.transitos_acreditados': 'llegada al banco de un depósito o traslado, al conciliar (§10.3)',
    // §10.10 integridad, activos y diferidos
    'ledger.asientos_sellos': 'cadena de hash de asientos (§10.10)',
    'ledger.activos': 'activo fijo; la baja es activos_bajas (§10.10)',
    'ledger.activos_bajas': 'baja de activo (§10.10)',
    'ledger.activos_cuotas': 'cuota de depreciación (§10.10)',
    'ledger.diferimientos': 'diferimiento (§10.10)',
    'ledger.diferimientos_cuotas': 'cuota de diferimiento (§10.10)',
}

/** Solo cambian una vez: al cerrarse. Un trigger rechaza UPDATE/DELETE de la fila ya cerrada. */
export const CIERRE_UNICO: Record<string, string> = {
    'ledger.cajas_turnos':
        'se abre con INSERT y se cierra con un UPDATE; cerrado, ya no cambia (hallazgo H3)',
}

/** La aplicación las actualiza: configuración o contadores, con `version` y `audit.cambios`. */
export const MUTABLES: Record<string, string> = {
    'ledger.cuentas': 'plan de cuentas: renombrar o desactivar (con movimientos no se borra: FK)',
    'ledger.cajas': 'catálogo de cajas (nombre, cajero, activa)',
    'ledger.bancos': 'catálogo de bancos del libro',
    'ledger.egresos_categorias': 'catálogo de categorías de egreso',
    'ledger.diarios': 'configuración de diarios por empresa (§10.7)',
    'ledger.secuencias': 'contador del correlativo (`ultimo`) tomado con FOR UPDATE (§10.7)',
    'ledger.proveedores': 'catálogo de proveedores con version (§3.4)',
    'ledger.reglas_conciliacion': 'configuración con version y audit.cambios (§10.3)',
    'ledger.proveedores_cobro':
        'fase 4 (A3): configuración del proveedor de cobro (nombre, banco, activo) con version y audit.cambios (§10.3)',
}

/** Texto para el mensaje de una tabla sin clasificar. */
export function comoClasificar(tabla: string): string {
    return (
        `${tabla}: agréguela en apps/api/tests/contabilidad/clasificacion_tablas.ts a INMUTABLES ` +
        `('${tabla}': 'motivo', si es solo inserción: con trigger BEFORE UPDATE/DELETE y REVOKE para argosisp_app), ` +
        `a CIERRE_UNICO (si cambia una sola vez al cerrarse) o a MUTABLES ('${tabla}': 'por qué la app la actualiza')`
    )
}
