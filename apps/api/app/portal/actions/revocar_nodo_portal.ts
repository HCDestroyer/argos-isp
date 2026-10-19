import { DomainAction, type Transaccion } from '#shared/domain_action'
import { verNodoPortal, type NodoPortalVista } from '#portal/nodos_portal'

export interface EntradaRevocarNodoPortal {
    id: number
}

/**
 * Revoca el token de un nodo portal: desde la siguiente petición la API le responde 401
 * `nodo_portal_invalido` (no hay caché que invalidar: cada petición lee `core.nodos_portal`).
 * Repetirla no cambia la fecha de revocación.
 */
export default class RevocarNodoPortal extends DomainAction<EntradaRevocarNodoPortal, NodoPortalVista> {
    readonly nombre = 'nodos_portal.revocar'

    protected async handle(input: EntradaRevocarNodoPortal, t: Transaccion): Promise<NodoPortalVista> {
        t.fijarEntidad('nodo_portal', input.id)
        const antes = await verNodoPortal(input.id, t.trx)
        if (antes.revocado_en) return antes

        await t.trx
            .from('core.nodos_portal')
            .where('id', input.id)
            .update({ revocado_en: t.trx.knexRawQuery('now()'), updated_at: t.trx.knexRawQuery('now()') })
        const despues = await verNodoPortal(input.id, t.trx)
        await t.registrarCambios(
            { tipo: 'nodo_portal', id: input.id },
            { revocado_en: antes.revocado_en },
            { revocado_en: despues.revocado_en },
        )
        return despues
    }
}
