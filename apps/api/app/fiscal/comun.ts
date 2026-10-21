import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { DateTime } from 'luxon'
import type { Transaccion } from '#shared/domain_action'
import { Problema } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { exigirEmpresaActiva, resolverEmpresaActiva } from '#core/empresas'
import { ZONA_NEGOCIO } from '#ledger/fechas'
import { LocalizacionNoInstalada, VigenciaEnPeriodoBloqueado } from '#fiscal/errores'
import { instalacionVigente, type FilaInstalacion } from '#fiscal/instalador'

/** Reloj del módulo, sustituible en pruebas (el régimen depende del día de hoy). */
export const relojFiscal = {
    ahora: (): Date => new Date(),
}

/** Hoy en Guatemala (YYYY-MM-DD) según `relojFiscal`. */
export function hoyFiscal(): string {
    return DateTime.fromJSDate(relojFiscal.ahora()).setZone(ZONA_NEGOCIO).toISODate()!
}

/**
 * Empresa de una acción fiscal: la indicada (422 si no existe o está desactivada) o la activa del
 * contexto; 403 si el actor no tiene acceso. La fija para la auditoría y exige que tenga
 * localización instalada (422 `localizacion_no_instalada`).
 */
export async function empresaFiscal(
    t: Transaccion,
    empresaId: number | null | undefined,
): Promise<{ empresaId: number; instalacion: FilaInstalacion }> {
    let id: number
    if (empresaId) {
        await exigirEmpresaActiva(t.trx, empresaId)
        id = empresaId
    } else {
        id = await resolverEmpresaActiva(t.ctx, t.trx)
    }
    exigirAccesoEmpresa(t.ctx, id)
    t.fijarEmpresa(id)
    const instalacion = await instalacionVigente(t.trx, id)
    if (!instalacion) throw new LocalizacionNoInstalada(id)
    return { empresaId: id, instalacion }
}

/** 403 si el actor no tiene alcance global (los valores globales afectan a todas las empresas). */
export function exigirAlcanceGlobal(t: Transaccion): void {
    const permitidas = t.ctx.empresasPermitidas
    if (permitidas !== null && permitidas !== undefined) {
        throw new Problema(
            403,
            'alcance_global_requerido',
            'Alcance global requerido',
            'Un valor global afecta a todas las empresas: requiere un usuario con alcance global',
        )
    }
}

/**
 * 422 `vigencia_en_periodo_bloqueado` si `vigenteDesde` cae en un mes cerrado (o antes de uno) o
 * bajo un bloqueo `global`, `impuestos` o `duro` vigente (fase 6, §10.4), porque cambiaría lo ya
 * reportado. Con `empresaId = null` (valor global) mira todas las empresas.
 */
export async function exigirVigenciaAbierta(
    trx: TransactionClientContract,
    empresaId: number | null,
    vigenteDesde: string,
): Promise<void> {
    const fila = (await trx
        .from('ledger.cierres_mensuales as c')
        .whereRaw(`c.periodo >= date_trunc('month', ?::date)`, [vigenteDesde])
        .whereNotExists((q) => q.from('ledger.reaperturas_mensuales as r').whereRaw('r.cierre_id = c.id'))
        .if(empresaId !== null, (q) => q.where('c.empresa_id', empresaId!))
        .orderBy('c.periodo', 'desc')
        .select(trx.raw(`to_char(c.periodo, 'YYYY-MM') as periodo`))
        .first()) as { periodo: string } | null
    if (fila) throw new VigenciaEnPeriodoBloqueado(vigenteDesde, fila.periodo)

    // bloqueos que cubren lo ya reportado (§10.4): global, impuestos y duro
    const bloqueo = (await trx
        .from('ledger.bloqueos as b')
        .whereIn('b.tipo', ['global', 'impuestos', 'duro'])
        .whereRaw(
            'b.id = (select max(x.id) from ledger.bloqueos x where x.empresa_id = b.empresa_id and x.tipo = b.tipo)',
        )
        .whereRaw('b.hasta >= ?::date', [vigenteDesde])
        .if(empresaId !== null, (q) => q.where('b.empresa_id', empresaId!))
        .orderBy('b.hasta', 'desc')
        .select('b.tipo', trx.raw(`to_char(b.hasta, 'YYYY-MM-DD') as hasta`))
        .first()) as { tipo: string; hasta: string } | null
    if (bloqueo) {
        throw new VigenciaEnPeriodoBloqueado(vigenteDesde, `bloqueo ${bloqueo.tipo} hasta ${bloqueo.hasta}`)
    }
}
