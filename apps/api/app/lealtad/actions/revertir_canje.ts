import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { hoyGuatemala } from '#ledger/fechas'
import { CanjeNoRevertible } from '#lealtad/errores'
import { camposAuditables, verCanje, type CanjeVista } from '#lealtad/canjes'
import { bloquearClienteLealtad, devolverCanje, movimientoPorClave } from '#lealtad/puntos'

/**
 * `lealtad.revertir_canje` (`POST /lealtad/canjes/:id/revertir { motivo }`, permiso
 * `lealtad.revertir_canje`, `Idempotency-Key`): solo un canje `reservado` (§5). Los puntos vuelven
 * en un lote nuevo por cada lote que pagó el canje, con su vencimiento original y su valor
 * (`devolverCanje`: `ajuste` positivo con origen `canje`, asiento `4.1.05 / 2.1.10`); nunca se edita el
 * movimiento del canje. Si el
 * premio lleva existencias, se devuelve la unidad. Un canje aplicado (nota de crédito emitida o plan
 * temporal programado) responde 409 `canje_no_revertible`. Evento `lealtad.canje_revertido`.
 */
export default class RevertirCanje extends DomainAction<{ id: number; motivo: string }, CanjeVista> {
    readonly nombre = 'lealtad.revertir_canje'

    protected async handle(input: { id: number; motivo: string }, t: Transaccion): Promise<CanjeVista> {
        t.fijarEntidad('canje_lealtad', input.id)
        const previo = await verCanje(input.id, t.trx)
        exigirAccesoEmpresa(t.ctx, previo.empresa_id)
        t.fijarEmpresa(previo.empresa_id)
        await bloquearClienteLealtad(t.trx, previo.cliente_id)
        const actual = await verCanje(input.id, t.trx, true)
        if (actual.estado !== 'reservado') {
            throw new CanjeNoRevertible(
                `El canje ${actual.id} está ${actual.estado}: solo se revierte uno reservado`,
            )
        }
        const motivo = input.motivo.trim()
        const salida = await movimientoPorClave(t.trx, actual.empresa_id, `canje:${actual.id}`)
        if (salida) await devolverCanje(t, salida, actual.id, hoyGuatemala(), motivo)
        const premio = (await t.trx
            .from('lealtad.premios')
            .where('id', actual.premio_id)
            .forUpdate()
            .select('existencias')
            .first()) as { existencias: number | null }
        if (premio.existencias !== null) {
            await t.trx
                .from('lealtad.premios')
                .where('id', actual.premio_id)
                .update({
                    existencias: Number(premio.existencias) + 1,
                    updated_at: t.trx.knexRawQuery('now()'),
                })
        }
        await t.trx
            .from('lealtad.canjes')
            .where('id', actual.id)
            .update({
                estado: 'revertido',
                revertido_en: t.trx.knexRawQuery('now()'),
                motivo,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        const revertido = await verCanje(actual.id, t.trx)
        await t.registrarCambios(
            { tipo: 'canje_lealtad', id: actual.id },
            camposAuditables(actual),
            camposAuditables(revertido),
        )
        await t.emit('lealtad.canje_revertido', {
            canje_id: revertido.id,
            empresa_id: revertido.empresa_id,
            cliente_id: revertido.cliente_id,
            servicio_id: revertido.servicio_id,
            premio_id: revertido.premio_id,
            tipo: revertido.tipo,
            puntos: revertido.puntos,
            factura_id: revertido.factura_id,
        })
        return revertido
    }
}
