import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { fechaValida } from '#ledger/fechas'
import RevertirAsiento from '#ledger/actions/revertir_asiento'
import { hoyFiscal } from '#fiscal/comun'
import { payloadDeclaracion } from '#fiscal/actions/calcular_declaracion'
import {
    LOCK_DECLARACIONES,
    textoDePeriodo,
    verDeclaracion,
    type DeclaracionFila,
} from '#fiscal/declaraciones'

/**
 * `declaraciones.anular_pago` (`POST /declaraciones/:id/anular-pago`, fase 7 PR C; hallazgo H35 del
 * auditor): anula el pago vigente de una versión (un pago mal registrado: otro banco, otra fecha, otro
 * monto). Revierte su asiento `pago_impuesto` (con fecha de hoy o la indicada, nunca anterior al pago) y
 * deja la anulación en `fiscal.declaraciones_pagos_anulaciones`, solo inserción: el pago no se toca.
 * Después se puede registrar otro pago de esa versión.
 *
 * - Sin pago vigente: 409 `declaracion_sin_pago`. Motivo de al menos 3 caracteres.
 * - El reverso entra por la anulación (`por_anulacion`), no por `libro.revertir_asiento` directo,
 *   que sigue respondiendo 409 `asiento_de_declaracion`.
 * - Emite `declaracion.pago_anulado` (monto = total del pago anulado).
 */

export interface EntradaAnularPagoDeclaracion {
    declaracion_id: number
    motivo: string
    /** fecha del reverso; por defecto hoy */
    fecha?: string | null
}

export default class AnularPagoDeclaracion extends DomainAction<
    EntradaAnularPagoDeclaracion,
    DeclaracionFila
> {
    readonly nombre = 'declaraciones.anular_pago'

    protected async handle(input: EntradaAnularPagoDeclaracion, t: Transaccion): Promise<DeclaracionFila> {
        const motivo = input.motivo?.trim() ?? ''
        const hoy = hoyFiscal()
        const fecha = input.fecha ? fechaValida(input.fecha) : hoy
        const errores = []
        if (motivo.length < 3) {
            errores.push({
                field: 'motivo',
                message: 'Motivo de la anulación (mínimo 3 caracteres)',
                rule: 'minLength',
            })
        }
        if (fecha > hoy) {
            errores.push({ field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' })
        }
        if (errores.length > 0) throw new ValidacionFallida(errores)

        const inicial = await verDeclaracion(input.declaracion_id, t.trx)
        exigirAccesoEmpresa(t.ctx, inicial.empresa_id)
        t.fijarEmpresa(inicial.empresa_id)
        t.fijarEntidad('declaracion', inicial.id)
        await t.trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_DECLARACIONES, inicial.empresa_id])
        const d = await verDeclaracion(input.declaracion_id, t.trx)
        const pago = d.pago
        if (!pago) {
            throw new Conflicto(
                `La declaración ${d.id} (${d.impuesto} ${textoDePeriodo(d.impuesto, d.periodo_desde)}) no tiene un pago vigente`,
                'declaracion_sin_pago',
                'Declaración sin pago',
            )
        }
        if (fecha < pago.fecha) {
            throw new ValidacionFallida([
                { field: 'fecha', message: `No puede ser anterior al pago (${pago.fecha})`, rule: 'fecha' },
            ])
        }

        const reverso = await new RevertirAsiento().execute(
            {
                asiento_id: pago.asiento_id,
                motivo: `Anulación del pago ${pago.id} de la declaración ${d.id}: ${motivo}`,
                fecha,
                por_anulacion: true,
            },
            t.ctx,
            { trx: t.trx },
        )
        await t.trx
            .insertQuery()
            .table('fiscal.declaraciones_pagos_anulaciones')
            .insert({
                pago_id: pago.id,
                empresa_id: d.empresa_id,
                motivo,
                asiento_id: reverso.id,
                anulado_por: usuarioDelActor(t.ctx.actor),
            })
        t.fijarEntidad('declaracion', d.id)
        t.anotarAuditoria({ pago_id: pago.id, asiento_reverso_id: reverso.id })

        const actual = await verDeclaracion(d.id, t.trx)
        await t.emit('declaracion.pago_anulado', {
            ...payloadDeclaracion(actual, pago.total),
            pago_id: pago.id,
            asiento_id: reverso.id,
            motivo,
        })
        return actual
    }
}
