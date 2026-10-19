import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { usuarioDelActor } from '#shared/contexto'
import { verArchivo } from '#lealtad/sorteos_archivos'
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
 * o `pendiente`. `cumplido` y `no_aplica` exigen evidencia: una referencia o texto (número de
 * resolución, de fianza, de recibo…) o un archivo subido antes (`archivo_id`, uso `evidencia`, de este
 * sorteo; `POST /lealtad/sorteos/:id/archivos`). Solo inserción: vale la última marca por clave. El
 * sistema no presenta memoriales ni paga impuestos.
 */

export interface EntradaMarcarRequisito {
    sorteo_id: number
    clave: RequisitoSorteo
    estado: EstadoRequisito
    valor?: string | null
    evidencia?: string | null
    /** archivo de evidencia de este sorteo (`lealtad.sorteos_archivos`, uso `evidencia`) */
    archivo_id?: number | null
    nota?: string | null
}

export default class MarcarRequisitoSorteo extends DomainAction<EntradaMarcarRequisito, RequisitoVigente[]> {
    readonly nombre = 'sorteos.marcar_requisito'

    protected async handle(input: EntradaMarcarRequisito, t: Transaccion): Promise<RequisitoVigente[]> {
        t.fijarEntidad('sorteo', input.sorteo_id)
        const sorteo = await verSorteo(input.sorteo_id, t.trx)
        exigirAccesoEmpresa(t.ctx, sorteo.empresa_id)
        t.fijarEmpresa(sorteo.empresa_id)
        let evidencia = input.evidencia?.trim() || null
        let archivoId: number | null = null
        if (input.archivo_id) {
            const archivo = await verArchivo(sorteo.id, input.archivo_id, t.trx).catch(() => null)
            if (!archivo || archivo.uso !== 'evidencia') {
                throw new ValidacionFallida([
                    {
                        field: 'archivo_id',
                        message: 'El archivo debe ser una evidencia subida a este sorteo',
                        rule: 'archivo',
                    },
                ])
            }
            archivoId = archivo.id
            evidencia ??= `Archivo ${archivo.id}: ${archivo.nombre} (SHA-256 ${archivo.sha256})`
        }
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
                archivo_id: archivoId,
                nota: input.nota?.trim() || null,
                marcado_por: usuarioDelActor(t.ctx.actor),
            })
        return requisitosVigentes(sorteo.id, t.trx)
    }
}
