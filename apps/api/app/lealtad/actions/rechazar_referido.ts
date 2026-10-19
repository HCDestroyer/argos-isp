import { DomainAction, type Transaccion } from '#shared/domain_action'
import { Conflicto } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { hoyGuatemala } from '#ledger/fechas'
import { bloquearClienteLealtad } from '#lealtad/puntos'
import { camposAuditables, verReferido, type ReferidoVista } from '#lealtad/referidos'
import { resultadoVacio, revertirClave } from '#lealtad/otorgamientos'

/**
 * `lealtad.rechazar_referido` (`POST /lealtad/referidos/:id/rechazar { motivo }`, permiso
 * `lealtad.ajustar`): un referido falso o duplicado. Si ya estaba calificado, revierte lo otorgado
 * al referidor y el bono del referido (con sus asientos, si el programa difiere). 409
 * `referido_rechazado` si ya estaba rechazado.
 */
export default class RechazarReferido extends DomainAction<{ id: number; motivo: string }, ReferidoVista> {
    readonly nombre = 'lealtad.rechazar_referido'

    protected async handle(input: { id: number; motivo: string }, t: Transaccion): Promise<ReferidoVista> {
        t.fijarEntidad('referido_lealtad', input.id)
        const previo = await verReferido(input.id, t.trx)
        exigirAccesoEmpresa(t.ctx, previo.empresa_id)
        t.fijarEmpresa(previo.empresa_id)
        for (const cliente of [previo.referidor_id, previo.referido_id].sort((a, b) => a - b)) {
            await bloquearClienteLealtad(t.trx, cliente)
        }
        const actual = await verReferido(input.id, t.trx, true)
        if (actual.estado === 'rechazado') {
            throw new Conflicto(
                `El referido ${actual.id} ya está rechazado`,
                'referido_rechazado',
                'Referido rechazado',
            )
        }
        const causa = {
            origen_tipo: 'referido' as const,
            origen_id: actual.id,
            fecha: hoyGuatemala(),
            motivo: input.motivo.trim(),
        }
        const resultado = resultadoVacio()
        await revertirClave(t, actual.empresa_id, `referido:${actual.id}`, causa, resultado)
        await revertirClave(t, actual.empresa_id, `referido:bono:${actual.id}`, causa, resultado)
        await t.trx
            .from('lealtad.referidos')
            .where('id', actual.id)
            .update({
                estado: 'rechazado',
                calificado_en: null,
                motivo: causa.motivo,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
        const rechazado = await verReferido(actual.id, t.trx)
        await t.registrarCambios(
            { tipo: 'referido_lealtad', id: actual.id },
            camposAuditables(actual),
            camposAuditables(rechazado),
        )
        return rechazado
    }
}
