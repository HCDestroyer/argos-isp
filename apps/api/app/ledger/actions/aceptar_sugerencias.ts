import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { NoEncontrado } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { LOCK_CONCILIACION } from '#ledger/conciliacion'
import { sugerenciasDeExtracto, type NivelSugerencia } from '#ledger/sugerencias_conciliacion'
import ConciliarLinea from '#ledger/actions/conciliar_linea'

/**
 * `bancos.aceptar_sugerencias` (`POST /bancos/extractos/:id/aceptar-seguras`, permiso
 * `bancos.conciliar`; plan de contabilidad §5.8, B3): concilia de una vez las líneas cuya sugerencia
 * es `segura` (mismo monto y misma referencia, un solo candidato), recalculadas dentro de la
 * transacción. Con `lineas[]`, solo esas; las que no son seguras se devuelven en `omitidas` con su
 * nivel. Cada línea pasa por `bancos.conciliar` (su asiento de llegada si es un depósito o traslado
 * en tránsito y su evento `banco.conciliado`). Repetirla no duplica: lo ya conciliado deja de ser
 * sugerencia.
 */

export interface EntradaAceptarSugerencias {
    extracto_id: number
    lineas?: number[] | null
}

export interface ResultadoAceptarSugerencias {
    extracto_id: number
    conciliadas: Array<{ linea_id: number; conciliacion_id: number }>
    omitidas: Array<{ linea_id: number; nivel: NivelSugerencia | 'conciliada' }>
}

export default class AceptarSugerencias extends DomainAction<
    EntradaAceptarSugerencias,
    ResultadoAceptarSugerencias
> {
    readonly nombre = 'bancos.aceptar_sugerencias'

    protected async handle(
        input: EntradaAceptarSugerencias,
        t: Transaccion,
    ): Promise<ResultadoAceptarSugerencias> {
        const extracto = (await t.trx
            .from('ledger.extractos')
            .where('id', input.extracto_id)
            .select('id', 'empresa_id', 'cuenta_id')
            .first()) as { id: number; empresa_id: number; cuenta_id: number } | null
        if (!extracto) throw new NoEncontrado(`El extracto ${input.extracto_id} no existe`)
        exigirAccesoEmpresa(t.ctx, Number(extracto.empresa_id))
        t.fijarEmpresa(Number(extracto.empresa_id))
        t.fijarEntidad('extracto', extracto.id)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?::int)', [
            LOCK_CONCILIACION,
            extracto.cuenta_id,
        ])
        const sugerencias = await sugerenciasDeExtracto(extracto.id, usuarioDelActor(t.ctx.actor), t.trx)
        const pedidas = input.lineas ? new Set(input.lineas) : null
        const resultado: ResultadoAceptarSugerencias = {
            extracto_id: extracto.id,
            conciliadas: [],
            omitidas: [],
        }
        const vistas = new Set<number>()
        for (const s of sugerencias.lineas) {
            if (pedidas && !pedidas.has(s.linea_id)) continue
            vistas.add(s.linea_id)
            if (s.nivel !== 'segura') {
                if (pedidas) resultado.omitidas.push({ linea_id: s.linea_id, nivel: s.nivel })
                continue
            }
            const c = s.candidatos[0]!
            const conciliacion = await new ConciliarLinea().execute(
                {
                    linea_id: s.linea_id,
                    movimientos: c.tipo === 'movimiento' ? [c.id] : [],
                    depositos: c.tipo === 'deposito' ? [c.id] : [],
                    traslados: c.tipo === 'traslado' ? [c.id] : [],
                },
                t.ctx,
                { trx: t.trx },
            )
            resultado.conciliadas.push({ linea_id: s.linea_id, conciliacion_id: conciliacion.id })
        }
        for (const id of pedidas ?? []) {
            if (!vistas.has(id)) resultado.omitidas.push({ linea_id: id, nivel: 'conciliada' })
        }
        return resultado
    }
}
