import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'

/**
 * Ajustes de cobro y libro por empresa (decisiones del PM del 21 nov). Sin fila en
 * `billing.ajustes_cobro`, los valores de fábrica (`AJUSTES_FABRICA`) y `version: 0`. Los cambia la
 * acción `ajustes_cobro.editar` (`PUT /ajustes-cobro`).
 */

export interface AjustesCobro {
    empresa_id: number
    /** decisión 10: un asiento manual queda como borrador hasta que otro usuario lo aprueba */
    asientos_requieren_aprobacion: boolean
    /** decisión 16: días máximos de una pausa sin cobro */
    pausa_tope_dias: number
    /** 0 = nunca se guardó (valores de fábrica) */
    version: number
    updated_by: number | null
    updated_at: Date | null
}

export const AJUSTES_FABRICA = {
    asientos_requieren_aprobacion: false,
    pausa_tope_dias: 90,
} as const

export const CAMPOS_AJUSTES_COBRO = ['asientos_requieren_aprobacion', 'pausa_tope_dias'] as const
export type CampoAjustesCobro = (typeof CAMPOS_AJUSTES_COBRO)[number]

export const PAUSA_TOPE_MAXIMO = 365

export async function leerAjustesCobro(
    empresaId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<AjustesCobro> {
    const fila = (await cliente
        .from('billing.ajustes_cobro')
        .where('empresa_id', empresaId)
        .select('asientos_requieren_aprobacion', 'pausa_tope_dias', 'version', 'updated_by', 'updated_at')
        .first()) as Omit<AjustesCobro, 'empresa_id'> | null
    if (!fila) {
        return { empresa_id: empresaId, ...AJUSTES_FABRICA, version: 0, updated_by: null, updated_at: null }
    }
    return {
        empresa_id: empresaId,
        asientos_requieren_aprobacion: fila.asientos_requieren_aprobacion,
        pausa_tope_dias: Number(fila.pausa_tope_dias),
        version: Number(fila.version),
        updated_by: fila.updated_by === null ? null : Number(fila.updated_by),
        updated_at: fila.updated_at,
    }
}
