import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { porIdentificarDe, type PorIdentificar } from '#ledger/diferencias_conciliacion'

/**
 * `bancos.marcar_por_identificar` (`POST /bancos/extractos/lineas/:id/por-identificar`, permiso
 * `bancos.conciliar`; plan de contabilidad §5.8, B3): «no sé todavía». La línea sin pareja queda
 * «por identificar» con una nota; no toca el libro y no cuenta como anomalía en la revisión
 * `extractos_conciliados` del cierre (se informa aparte). Volver a marcarla cambia la nota (fila
 * nueva). Al conciliarla deja de estar por identificar. 409 `linea_conciliada` si ya está conciliada.
 */
export default class MarcarPorIdentificar extends DomainAction<
    { linea_id: number; nota: string },
    PorIdentificar & { linea_id: number }
> {
    readonly nombre = 'bancos.marcar_por_identificar'

    protected async handle(
        input: { linea_id: number; nota: string },
        t: Transaccion,
    ): Promise<PorIdentificar & { linea_id: number }> {
        const nota = input.nota?.trim() ?? ''
        if (nota.length < 3) {
            throw new ValidacionFallida([
                { field: 'nota', message: 'Escribe qué se sabe de la línea', rule: 'required' },
            ])
        }
        const linea = (await t.trx
            .from('ledger.extractos_lineas as l')
            .where('l.id', input.linea_id)
            .select(
                'l.id',
                'l.empresa_id',
                t.trx.raw(
                    `EXISTS (SELECT 1 FROM ledger.conciliaciones k WHERE k.linea_id = l.id
                       AND NOT EXISTS (SELECT 1 FROM ledger.conciliaciones_anulaciones x WHERE x.conciliacion_id = k.id)) as conciliada`,
                ),
            )
            .first()) as { id: number; empresa_id: number; conciliada: boolean } | null
        if (!linea) throw new NoEncontrado(`La línea de extracto ${input.linea_id} no existe`)
        exigirAccesoEmpresa(t.ctx, Number(linea.empresa_id))
        t.fijarEmpresa(Number(linea.empresa_id))
        t.fijarEntidad('extracto_linea', linea.id)
        if (linea.conciliada) {
            throw new Conflicto(
                `La línea ${linea.id} ya está conciliada`,
                'linea_conciliada',
                'Línea conciliada',
            )
        }
        await t.trx
            .insertQuery()
            .table('billing.lineas_por_identificar')
            .insert({
                empresa_id: Number(linea.empresa_id),
                linea_id: linea.id,
                nota,
                marcado_por: usuarioDelActor(t.ctx.actor),
            })
        const marcas = await porIdentificarDe([Number(linea.id)], t.trx)
        const marca = marcas.get(Number(linea.id))!
        return { linea_id: Number(linea.id), ...marca }
    }
}
