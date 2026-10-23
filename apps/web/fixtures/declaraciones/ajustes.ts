import type { Schema } from '@argosisp/contracts'

/**
 * Ajustes fiscales de ArgosNet (A3, fase 7 PR C, desvío a): llevan el resultado contable a la renta
 * imponible del ISR por cierre parcial (trimestre) o anual (`trimestre` null). Solo inserción: el 2 anula
 * al 1 (`anula_a`), que queda con `anulado_por_ajuste`. Vigente: el 3, anual de 2026.
 */
export function ajustesIniciales(): Schema<'AjusteFiscal'>[] {
    return [
        { id: 1, empresa_id: 1, anio: 2026, trimestre: null, efecto: 'suma', concepto: 'Donación sin constancia (no deducible)', monto: '800.00', anula_a: null, anulado_por_ajuste: 2, registrado_por: 1, created_at: '2026-10-05T16:00:00.000Z' },
        { id: 2, empresa_id: 1, anio: 2026, trimestre: null, efecto: 'suma', concepto: 'Registrado dos veces', monto: '800.00', anula_a: 1, anulado_por_ajuste: null, registrado_por: 1, created_at: '2026-10-06T16:00:00.000Z' },
        { id: 3, empresa_id: 1, anio: 2026, trimestre: null, efecto: 'resta', concepto: 'Intereses bancarios exentos', monto: '350.00', anula_a: null, anulado_por_ajuste: null, registrado_por: 1, created_at: '2026-10-07T16:00:00.000Z' },
    ]
}
