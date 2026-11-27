import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { ContextoAccion } from '#shared/contexto'
import { usuarioDelActor } from '#shared/contexto'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { Conflicto, NoEncontrado } from '#shared/errores'
import { verEgreso, type EgresoVista } from '#ledger/egresos'
import {
    auditable,
    comprobanteDeEgreso,
    validarArchivoComprobante,
    type ArchivoAuditable,
    type ArchivoSubido,
} from '#ledger/comprobantes_egreso'
import { borrarArchivoComprobante, guardarArchivoComprobante } from '#billing/comprobantes_archivos'

/**
 * `egresos.adjuntar_comprobante` (`POST /egresos/:id/comprobante`, multipart): agrega el archivo del
 * comprobante (foto o PDF) a un egreso que no lo tiene. Una sola vez: 409 `comprobante_existente` (el
 * egreso no se edita). B9: lo usan las compras al contado pagadas con la caja chica (la compra se
 * registra sin archivo) antes de reponerla: una reposición no sella gastos sin comprobante. Sirve para
 * cualquier egreso. Evento `egreso.comprobante_adjuntado`.
 */

export interface EntradaAdjuntarComprobanteEgreso {
    egreso_id: number
    archivo: ArchivoSubido | ArchivoAuditable | null
}

export default class AdjuntarComprobanteEgreso extends DomainAction<
    EntradaAdjuntarComprobanteEgreso,
    EgresoVista
> {
    readonly nombre = 'egresos.adjuntar_comprobante'

    override execute(
        input: EntradaAdjuntarComprobanteEgreso,
        ctx: ContextoAccion,
        opciones: { trx?: TransactionClientContract } = {},
    ): Promise<EgresoVista> {
        return super.execute({ ...input, archivo: auditable(input.archivo) }, ctx, opciones)
    }

    protected async handle(input: EntradaAdjuntarComprobanteEgreso, t: Transaccion): Promise<EgresoVista> {
        t.fijarEntidad('egreso', input.egreso_id)
        const egreso = (await t.trx
            .from('ledger.egresos')
            .where('id', input.egreso_id)
            .forUpdate()
            .select('id', 'empresa_id', 'caja_id')
            .first()) as { id: number; empresa_id: number; caja_id: number | null } | null
        if (!egreso) throw new NoEncontrado(`El egreso ${input.egreso_id} no existe`)
        const empresaId = Number(egreso.empresa_id)
        exigirAccesoEmpresa(t.ctx, empresaId)
        t.fijarEmpresa(empresaId)
        const { tipo, ruta } = validarArchivoComprobante(input.archivo)
        if (await comprobanteDeEgreso(egreso.id, t.trx)) {
            throw new Conflicto(
                `El egreso ${egreso.id} ya tiene su comprobante`,
                'comprobante_existente',
                'Comprobante existente',
            )
        }
        const contenido = input.archivo!.contenido
        await t.trx
            .insertQuery()
            .table('ledger.egresos_comprobantes')
            .insert({
                egreso_id: egreso.id,
                empresa_id: empresaId,
                archivo: ruta,
                tipo,
                tamano: contenido.length,
                nombre: input.archivo?.nombre ?? null,
                subido_por: usuarioDelActor(t.ctx.actor),
            })
        await guardarArchivoComprobante(ruta, contenido)
        try {
            await t.emit('egreso.comprobante_adjuntado', {
                egreso_id: egreso.id,
                empresa_id: empresaId,
                caja_id: egreso.caja_id === null ? null : Number(egreso.caja_id),
                tipo_archivo: tipo,
                tamano: contenido.length,
            })
            return await verEgreso(egreso.id, t.trx)
        } catch (error) {
            await borrarArchivoComprobante(ruta).catch(() => {})
            throw error
        }
    }
}
