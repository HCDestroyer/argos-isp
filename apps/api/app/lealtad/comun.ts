import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { ReglaNegocio } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import { PAIS_PLAN } from '#ledger/plan_cuentas'
import { CUENTAS_GT } from '#fiscal/l10n/gt/cuentas'

/** Empresa de una acción de lealtad: `empresa_id` (activa y con acceso) o la activa del contexto. */
export async function empresaLealtad(t: Transaccion, empresaId: number | null | undefined): Promise<number> {
    let id: number
    if (empresaId) {
        await exigirEmpresaActiva(t.trx, empresaId)
        id = empresaId
    } else {
        id = await resolverEmpresaActiva(t.ctx, t.trx)
    }
    exigirAccesoEmpresa(t.ctx, id)
    t.fijarEmpresa(id)
    return id
}

/** Cuentas del pasivo del programa (§6), del contrato de localización fiscal. */
export const CUENTAS_LEALTAD = [
    CUENTAS_GT.PASIVO_LEALTAD,
    CUENTAS_GT.INGRESOS_DIFERIDOS_LEALTAD,
    CUENTAS_GT.INGRESOS_PUNTOS,
] as const

/**
 * Con diferimiento, las cuentas `2.1.10`, `4.1.05` y `4.1.06` deben existir y estar activas (las
 * instala la localización fiscal): 422 `cuentas_lealtad_faltantes` si no.
 */
export async function exigirCuentasLealtad(cliente: QueryClientContract): Promise<void> {
    const filas = (await cliente
        .from('ledger.cuentas')
        .where('pais', PAIS_PLAN)
        .whereIn('codigo', [...CUENTAS_LEALTAD])
        .where('activa', true)
        .where('imputable', true)
        .select('codigo')) as Array<{ codigo: string }>
    const faltan = CUENTAS_LEALTAD.filter((c) => !filas.some((f) => f.codigo === c))
    if (faltan.length > 0) {
        throw new ReglaNegocio(
            `El diferimiento necesita las cuentas ${faltan.join(', ')} (localización fiscal)`,
            'cuentas_lealtad_faltantes',
        )
    }
}
