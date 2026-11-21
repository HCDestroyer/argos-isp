import { DomainAction, type Transaccion } from '#shared/domain_action'
import { serializarCorreo, type CorreoExterno } from '#billing/reportes/envios'

export interface EntradaAprobarCorreo {
    correo: string
    nombre: string
}

/**
 * `reportes.aprobar_correo_externo` (solo admin; decisión 6 del PM): agrega un correo externo
 * (contador, socio) a la lista que puede recibir reportes contables programados. Si ya estaba y se
 * retiró, se reactiva. Idempotente: aprobar uno activo solo actualiza el nombre. El evento nunca
 * lleva la dirección.
 */
export default class AprobarCorreoExterno extends DomainAction<EntradaAprobarCorreo, CorreoExterno> {
    readonly nombre = 'reportes.aprobar_correo_externo'

    protected async handle(input: EntradaAprobarCorreo, t: Transaccion): Promise<CorreoExterno> {
        t.fijarEmpresa(null)
        const correo = input.correo.trim().toLowerCase()
        const antes = (await t.trx
            .from('billing.reportes_correos_externos')
            .where('correo', correo)
            .forUpdate()
            .first()) as Record<string, unknown> | null
        let id: number
        let accion: 'aprobado' | 'reactivado' | null = null
        if (!antes) {
            const [fila] = (await t.trx
                .table('billing.reportes_correos_externos')
                .insert({ correo, nombre: input.nombre, aprobado_por: t.ctx.actor.id })
                .returning('id')) as Array<{ id: number }>
            id = Number(fila!.id)
            accion = 'aprobado'
        } else {
            id = Number(antes.id)
            const reactivar = !antes.activo
            if (reactivar || antes.nombre !== input.nombre) {
                await t.trx
                    .from('billing.reportes_correos_externos')
                    .where('id', id)
                    .update({
                        nombre: input.nombre,
                        ...(reactivar
                            ? {
                                  activo: true,
                                  aprobado_por: t.ctx.actor.id,
                                  aprobado_en: t.trx.knexRawQuery('now()'),
                                  retirado_por: null,
                                  retirado_en: null,
                              }
                            : {}),
                        version: t.trx.knexRawQuery('version + 1'),
                        updated_at: t.trx.knexRawQuery('now()'),
                    })
                await t.registrarCambios(
                    { tipo: 'correo_externo_reporte', id },
                    { nombre: antes.nombre, activo: antes.activo },
                    { nombre: input.nombre, activo: true },
                )
            }
            if (reactivar) accion = 'reactivado'
        }
        t.fijarEntidad('correo_externo_reporte', id)
        if (accion) {
            const envios = (await t.trx
                .from('billing.reportes_envios_destinatarios')
                .where('correo_externo_id', id)
                .count('* as n')
                .first()) as { n: number | string }
            await t.emit('reportes.correo_externo_cambiado', {
                correo_externo_id: id,
                accion,
                envios_afectados: Number(envios.n),
            })
        }
        return serializarCorreo(
            (await t.trx.from('billing.reportes_correos_externos').where('id', id).first()) as Record<
                string,
                unknown
            >,
        )
    }
}
