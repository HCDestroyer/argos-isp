import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { serializarCorreo, type CorreoExterno } from '#billing/reportes/envios'

/**
 * `reportes.retirar_correo_externo` (solo admin): el correo deja de recibir reportes desde el
 * siguiente envío (cada corrida lo omite con `correo_retirado`). La fila no se borra: los envíos y
 * sus corridas la siguen nombrando. Retirar uno ya retirado no hace nada.
 */
export default class RetirarCorreoExterno extends DomainAction<{ id: number }, CorreoExterno> {
    readonly nombre = 'reportes.retirar_correo_externo'

    protected async handle(input: { id: number }, t: Transaccion): Promise<CorreoExterno> {
        t.fijarEmpresa(null)
        t.fijarEntidad('correo_externo_reporte', input.id)
        const antes = (await t.trx
            .from('billing.reportes_correos_externos')
            .where('id', input.id)
            .forUpdate()
            .first()) as Record<string, unknown> | null
        if (!antes) throw new NoEncontrado(`El correo externo ${input.id} no existe`)
        if (antes.activo) {
            await t.trx
                .from('billing.reportes_correos_externos')
                .where('id', input.id)
                .update({
                    activo: false,
                    retirado_por: t.ctx.actor.id,
                    retirado_en: t.trx.knexRawQuery('now()'),
                    version: t.trx.knexRawQuery('version + 1'),
                    updated_at: t.trx.knexRawQuery('now()'),
                })
            await t.registrarCambios(
                { tipo: 'correo_externo_reporte', id: input.id },
                { activo: true },
                { activo: false },
            )
            const envios = (await t.trx
                .from('billing.reportes_envios_destinatarios')
                .where('correo_externo_id', input.id)
                .count('* as n')
                .first()) as { n: number | string }
            await t.emit('reportes.correo_externo_cambiado', {
                correo_externo_id: input.id,
                accion: 'retirado',
                envios_afectados: Number(envios.n),
            })
        }
        return serializarCorreo(
            (await t.trx.from('billing.reportes_correos_externos').where('id', input.id).first()) as Record<
                string,
                unknown
            >,
        )
    }
}
