import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion } from '#shared/errores'
import { filaAccesos, verAccesosRapidos, type AccesosRapidos } from '#core/accesos_rapidos'

export interface EntradaEditarAccesosRapidos {
    /** el usuario de la sesión (nunca otro) */
    usuario_id: number
    /** lista ordenada (validada en la ruta); null = volver a los predeterminados por rol */
    secciones: string[] | null
    /** omitido = último gana */
    version?: number
}

/**
 * Guarda los accesos rápidos del propio usuario (`accesos_rapidos.editar`, sin permiso del ACL;
 * contrato `accesos-rapidos.md` §3). Con lista guardada y `version` distinta → 409. Diff de
 * `secciones` en `audit.cambios` (`usuario`, id).
 */
export default class EditarAccesosRapidos extends DomainAction<EntradaEditarAccesosRapidos, AccesosRapidos> {
    readonly nombre = 'accesos_rapidos.editar'

    protected async handle(input: EntradaEditarAccesosRapidos, t: Transaccion): Promise<AccesosRapidos> {
        t.fijarEntidad('usuario', input.usuario_id)
        const antes = await filaAccesos(input.usuario_id, t.trx, true)
        if (antes && input.version !== undefined && input.version !== antes.version) {
            throw new ConflictoVersion('core.accesos_rapidos', input.usuario_id)
        }
        const previas = antes?.secciones ?? null
        if (JSON.stringify(previas) !== JSON.stringify(input.secciones)) {
            if (antes) {
                await t.trx
                    .from('core.accesos_rapidos')
                    .where('usuario_id', input.usuario_id)
                    .update({
                        secciones: input.secciones,
                        version: t.trx.knexRawQuery('version + 1'),
                        updated_at: t.trx.knexRawQuery('now()'),
                    })
            } else {
                await t.trx.table('core.accesos_rapidos').insert({
                    usuario_id: input.usuario_id,
                    secciones: input.secciones,
                })
            }
            await t.registrarCambios(
                { tipo: 'usuario', id: input.usuario_id },
                { accesos_rapidos: previas },
                { accesos_rapidos: input.secciones },
            )
        }
        return verAccesosRapidos(input.usuario_id, t.trx)
    }
}
