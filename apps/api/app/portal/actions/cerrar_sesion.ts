import { DomainAction, type Transaccion } from '#shared/domain_action'

export interface EntradaCerrarSesionPortal {
    sesionId: number
    clienteId: number
}

/** Cierra la sesión del portal (`POST /portal/salir`): la marca revocada. La ruta borra la cookie. */
export default class CerrarSesionPortal extends DomainAction<EntradaCerrarSesionPortal, void> {
    readonly nombre = 'portal.cerrar_sesion'

    protected async handle(input: EntradaCerrarSesionPortal, t: Transaccion): Promise<void> {
        t.fijarEntidad('cliente', input.clienteId)
        await t.trx
            .from('core.portal_sesiones')
            .where('id', input.sesionId)
            .whereNull('revocada_en')
            .update({ revocada_en: t.trx.knexRawQuery('now()') })
    }
}
