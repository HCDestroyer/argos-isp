import { DomainAction, type Transaccion } from '#shared/domain_action'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { ReglaNegocio } from '#shared/errores'
import { hoyGuatemala } from '#ledger/fechas'
import { CanjeNoRevertible } from '#lealtad/errores'
import { camposAuditables, verCanje, type CanjeVista } from '#lealtad/canjes'
import { bloquearClienteLealtad, devolverCanje, movimientoPorClave } from '#lealtad/puntos'

/**
 * `lealtad.revertir_canje` (`POST /lealtad/canjes/:id/revertir { motivo }`, permiso
 * `lealtad.revertir_canje`, `Idempotency-Key`): un canje `reservado`, o `aplicado` a una factura que se
 * anuló (§5). Los puntos vuelven
 * en un lote nuevo por cada lote que pagó el canje, con su vencimiento original y su valor
 * (`devolverCanje`: `ajuste` positivo con origen `canje`, asiento `4.1.05 / 2.1.10`); nunca se edita el
 * movimiento del canje. Si el
 * premio lleva existencias, se devuelve la unidad. Un canje aplicado (nota de crédito emitida o plan
 * temporal programado) responde 409 `canje_no_revertible`. Evento `lealtad.canje_revertido`.
 */
export interface EntradaRevertirCanje {
    id: number
    motivo: string
    /** interno: solo desde `sorteos.anular_entrega` (el canje sin puntos del premio de un sorteo) */
    por_entrega_anulada?: boolean
}

export default class RevertirCanje extends DomainAction<EntradaRevertirCanje, CanjeVista> {
    readonly nombre = 'lealtad.revertir_canje'

    protected async handle(input: EntradaRevertirCanje, t: Transaccion): Promise<CanjeVista> {
        t.fijarEntidad('canje_lealtad', input.id)
        const previo = await verCanje(input.id, t.trx)
        exigirAccesoEmpresa(t.ctx, previo.empresa_id)
        t.fijarEmpresa(previo.empresa_id)
        await bloquearClienteLealtad(t.trx, previo.cliente_id)
        const actual = await verCanje(input.id, t.trx, true)
        // un descuento aplicado a una factura que después se anuló también vuelve (§5)
        let facturaAnulada = false
        if (actual.estado === 'aplicado' && actual.factura_id !== null && actual.nota_credito_id === null) {
            const factura = (await t.trx
                .from('billing.facturas')
                .where('id', actual.factura_id)
                .select('estado')
                .first()) as { estado: string } | null
            facturaAnulada = factura?.estado === 'anulada'
        }
        // H22: el canje de un premio de sorteo se deshace solo con `sorteos.anular_entrega`
        const sorteoGanador = (await t.trx
            .from('lealtad.canjes')
            .where('id', actual.id)
            .select('sorteo_ganador_id')
            .first()) as { sorteo_ganador_id: number | null } | null
        const dePremio = (sorteoGanador?.sorteo_ganador_id ?? null) !== null
        if (dePremio && !input.por_entrega_anulada) {
            throw new ReglaNegocio(
                `El canje ${actual.id} es el premio del ganador ${sorteoGanador!.sorteo_ganador_id} de un sorteo: se deshace anulando su entrega (POST /lealtad/sorteos/:id/ganadores/:ganadorId/anular-entrega)`,
                'canje_de_premio_sorteo',
            )
        }
        if (actual.estado !== 'reservado' && !facturaAnulada) {
            throw new CanjeNoRevertible(
                `El canje ${actual.id} está ${actual.estado}: solo se revierte uno reservado o aplicado a una factura anulada`,
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
        // el premio de un sorteo no tomó existencias (canje sin puntos): no se devuelven
        if (premio.existencias !== null && !dePremio) {
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
