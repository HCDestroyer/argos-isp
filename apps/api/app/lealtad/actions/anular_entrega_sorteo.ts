import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import AnularEgreso from '#ledger/actions/anular_egreso'
import { bloquearCliente } from '#billing/cobros'
import RevertirCanje from '#lealtad/actions/revertir_canje'
import { detalleSorteo, exigirEstado, ganadoresDe, verSorteo } from '#lealtad/sorteos'

/**
 * `sorteos.anular_entrega` (`POST /lealtad/sorteos/:id/ganadores/:ganadorId/anular-entrega`, permiso
 * `sorteos.entregar`, con motivo). H22 (auditor): deshace la entrega de un premio **toda junta**, en una
 * transacción:
 *
 * - `efectivo`: anula su egreso (categoría `premios`) con `AnularEgreso`;
 * - `bien`: revierte su asiento `sorteo` (`5.1.03 / 2.1.03` o la cuenta de activo);
 * - `servicio`: revierte el canje sin puntos del ganador (sin devolver existencias: no las tomó); si
 *   el descuento ya se aplicó a una factura, 409 `canje_no_revertible`;
 * - el asiento del ISR (`5.1.03 / 2.1.05`) se revierte en todos los casos.
 *
 * El ganador vuelve a `por_notificar` (sin asiento, egreso, canje ni retención) y, si el sorteo estaba
 * `premios_entregados`, vuelve a `ejecutado` (única vuelta atrás que permite el trigger del estado,
 * con `lealtad.reabrir_entrega`). Directo, `AnularEgreso`, `RevertirCanje` y `RevertirAsiento`
 * rechazan esos documentos (422). Evento `sorteo.entrega_anulada`.
 */

export interface EntradaAnularEntrega {
    sorteo_id: number
    ganador_id: number
    motivo: string
}

export default class AnularEntregaSorteo extends DomainAction<
    EntradaAnularEntrega,
    Awaited<ReturnType<typeof detalleSorteo>>
> {
    readonly nombre = 'sorteos.anular_entrega'

    protected async handle(input: EntradaAnularEntrega, t: Transaccion) {
        t.fijarEntidad('sorteo', input.sorteo_id)
        const motivo = input.motivo?.trim() ?? ''
        if (motivo.length < 3) {
            throw new ValidacionFallida([
                {
                    field: 'motivo',
                    message: 'El motivo es obligatorio (mínimo 3 caracteres)',
                    rule: 'motivo',
                },
            ])
        }
        const sorteo = await verSorteo(input.sorteo_id, t.trx, true)
        exigirAccesoEmpresa(t.ctx, sorteo.empresa_id)
        t.fijarEmpresa(sorteo.empresa_id)
        exigirEstado(sorteo, ['ejecutado', 'premios_entregados'], 'anular la entrega de un premio')
        const todos = await ganadoresDe(sorteo.id, t.trx)
        const ganador = todos.find((g) => g.id === input.ganador_id)
        if (!ganador) throw new NoEncontrado(`El ganador ${input.ganador_id} no es del sorteo ${sorteo.id}`)
        if (ganador.estado !== 'entregado') {
            throw new ReglaNegocio(
                `El premio del ganador ${ganador.id} no está entregado`,
                'premio_no_entregado',
            )
        }
        await bloquearCliente(t.trx, ganador.cliente_id)
        const razon = `anulación de la entrega del premio del ganador ${ganador.id} (sorteo ${sorteo.id}): ${motivo}`

        if (ganador.egreso_id !== null) {
            await new AnularEgreso().execute(
                { egreso_id: ganador.egreso_id, motivo: razon, por_entrega_anulada: true },
                t.ctx,
                { trx: t.trx },
            )
        }
        if (ganador.canje_id !== null) {
            await new RevertirCanje().execute(
                { id: ganador.canje_id, motivo: razon, por_entrega_anulada: true },
                t.ctx,
                { trx: t.trx },
            )
        }
        if (ganador.asiento_id !== null) {
            await new RevertirAsiento().execute(
                { asiento_id: ganador.asiento_id, motivo: razon, por_anulacion: true },
                t.ctx,
                { trx: t.trx },
            )
        }

        const antes = {
            estado: ganador.estado,
            asiento_id: ganador.asiento_id,
            egreso_id: ganador.egreso_id,
            canje_id: ganador.canje_id,
            retencion_isr: ganador.retencion_isr,
            contrapartida: ganador.contrapartida,
        }
        await t.trx
            .from('lealtad.sorteos_ganadores')
            .where('id', ganador.id)
            .update({
                estado: 'por_notificar',
                asiento_id: null,
                egreso_id: null,
                canje_id: null,
                compra_linea_id: null,
                retencion_isr: null,
                contrapartida: null,
                entregado_en: null,
                entregado_por: null,
                nota: motivo,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.registrarCambios({ tipo: 'sorteo_ganador', id: ganador.id }, antes, {
            estado: 'por_notificar',
            asiento_id: null,
            egreso_id: null,
            canje_id: null,
            retencion_isr: null,
            contrapartida: null,
        })
        if (sorteo.estado === 'premios_entregados') {
            await t.trx.rawQuery(`SET LOCAL lealtad.reabrir_entrega = 'on'`)
            await t.trx
                .from('lealtad.sorteos')
                .where('id', sorteo.id)
                .update({
                    estado: 'ejecutado',
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                } as Record<string, unknown>)
            await t.trx.rawQuery(`SET LOCAL lealtad.reabrir_entrega = 'off'`)
            await t.registrarCambios(
                { tipo: 'sorteo', id: sorteo.id },
                { estado: 'premios_entregados' },
                { estado: 'ejecutado' },
            )
        }
        t.fijarEntidad('sorteo', sorteo.id)
        await t.emit('sorteo.entrega_anulada', {
            sorteo_id: sorteo.id,
            empresa_id: sorteo.empresa_id,
            cliente_id: ganador.cliente_id,
            posicion: ganador.posicion,
            motivo,
        })
        return detalleSorteo(sorteo.id, t.trx)
    }
}
