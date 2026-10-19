import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { usuarioDelActor } from '#shared/contexto'
import {
    requisitosVigentes,
    verSorteo,
    type EstadoRequisito,
    type RequisitoSorteo,
    type RequisitoVigente,
} from '#lealtad/sorteos'

/**
 * `sorteos.marcar_requisito` (`POST /lealtad/sorteos/:id/requisitos/:clave`, permiso
 * `sorteos.marcar_requisito`): marca un requisito del checklist legal (§8) como `cumplido`, `no_aplica`
 * o `pendiente`. `cumplido` y `no_aplica` exigen `evidencia` (en esta fase, una referencia o texto: el
 * número de resolución, de fianza, de recibo…; la subida de archivos llega con la segunda PR). Solo
 * inserción: vale la última marca por clave. El sistema no presenta memoriales ni paga impuestos.
 */

export interface EntradaMarcarRequisito {
    sorteo_id: number
    clave: RequisitoSorteo
    estado: EstadoRequisito
    valor?: string | null
    evidencia?: string | null
    nota?: string | null
}

export default class MarcarRequisitoSorteo extends DomainAction<EntradaMarcarRequisito, RequisitoVigente[]> {
    readonly nombre = 'sorteos.marcar_requisito'

    protected async handle(input: EntradaMarcarRequisito, t: Transaccion): Promise<RequisitoVigente[]> {
        t.fijarEntidad('sorteo', input.sorteo_id)
        const sorteo = await verSorteo(input.sorteo_id, t.trx)
        exigirAccesoEmpresa(t.ctx, sorteo.empresa_id)
        t.fijarEmpresa(sorteo.empresa_id)
        const evidencia = input.evidencia?.trim() || null
        if (input.estado !== 'pendiente' && !evidencia) {
            throw new ValidacionFallida([
                {
                    field: 'evidencia',
                    message:
                        'Un requisito cumplido o que no aplica lleva su evidencia (número, referencia o texto)',
                    rule: 'required',
                },
            ])
        }
        if (sorteo.estado === 'cancelado') {
            throw new ValidacionFallida([
                { field: 'sorteo_id', message: 'El sorteo está cancelado', rule: 'estado' },
            ])
        }
        await t.trx
            .insertQuery()
            .table('lealtad.sorteos_requisitos')
            .insert({
                sorteo_id: sorteo.id,
                clave: input.clave,
                estado: input.estado,
                valor: input.valor?.trim() || null,
                evidencia,
                nota: input.nota?.trim() || null,
                marcado_por: usuarioDelActor(t.ctx.actor),
            })
        return requisitosVigentes(sorteo.id, t.trx)
    }
}
