import { DomainAction, type Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Problema } from '#shared/errores'
import { bloquearBorrador, verBorrador, type BorradorAsientoVista } from '#ledger/borradores'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { lineasDeAsiento } from '#ledger/actions/registrar_asiento_manual'

/**
 * `libro.aprobar_asiento` (`POST /libro/borradores/:id/aprobar`, decisión del PM 10): registra el
 * asiento del borrador con `RegistrarAsiento` anidada (misma transacción), con la fecha del borrador
 * o la de hoy. **Quien lo creó no puede aprobarlo** (403 `autoaprobacion`). Si el mes se cerró o una
 * cuenta se desactivó desde entonces, responde el error de `RegistrarAsiento` y el borrador sigue
 * pendiente (se rechaza). Un borrador se decide una vez (409 `borrador_decidido`); la decisión es una
 * fila de `billing.asientos_borradores_decisiones`. Evento `libro.asiento_manual_registrado` con
 * `borrador_id` y `aprobado_por`.
 */
export default class AprobarAsiento extends DomainAction<{ borrador_id: number }, BorradorAsientoVista> {
    readonly nombre = 'libro.aprobar_asiento'

    protected async handle(input: { borrador_id: number }, t: Transaccion): Promise<BorradorAsientoVista> {
        const borrador = await bloquearBorrador(t, input.borrador_id)
        const aprobador = usuarioDelActor(t.ctx.actor)
        if (aprobador === null || aprobador === borrador.creado_por) {
            throw new Problema(
                403,
                'autoaprobacion',
                'No puedes aprobar tu propio asiento',
                'Quien registra un asiento manual no puede aprobarlo: lo aprueba otro usuario con libro.aprobar_asiento',
            )
        }
        const asiento = await new RegistrarAsiento().execute(
            {
                empresa_id: borrador.empresa_id,
                ...(borrador.fecha ? { fecha: borrador.fecha } : {}),
                descripcion: borrador.descripcion,
                origen_tipo: 'ajuste',
                origen_id: null,
                movimientos: lineasDeAsiento(borrador.movimientos),
            },
            t.ctx,
            { trx: t.trx },
        )
        t.fijarEntidad('asiento_borrador', borrador.id)
        t.fijarEmpresa(borrador.empresa_id)
        await t.trx.insertQuery().table('billing.asientos_borradores_decisiones').insert({
            borrador_id: borrador.id,
            decision: 'aprobado',
            asiento_id: asiento.id,
            decidido_por: aprobador,
        })
        await t.emit('libro.asiento_manual_registrado', {
            asiento_id: asiento.id,
            empresa_id: borrador.empresa_id,
            borrador_id: borrador.id,
            total: borrador.total,
            registrado_por: borrador.creado_por,
            aprobado_por: aprobador,
        })
        return verBorrador(borrador.id, t.trx)
    }
}
