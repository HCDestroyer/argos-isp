import { DomainAction, type Transaccion } from '#shared/domain_action'
import { bloquearConectorIris } from '#integraciones/iris/configuracion'
import { confirmarCanjeIris } from '#integraciones/iris/desconexion'

export interface EntradaConfirmarCanjeIris {
    /** id (`core.tokens_api.id`) del token en su primera llamada; no se llama `token_*` para que la auditoría no lo enmascare */
    atk_id: number
}

export interface SalidaConfirmarCanjeIris {
    /** `reconectado`: se aplicó la reconexión pendiente; `confirmado`: canje directo; null: nada que hacer */
    resultado: 'reconectado' | 'confirmado' | null
}

/**
 * `iris.confirmar_canje` (contrato Iris 0.6.3): la primera llamada autenticada con el `atk_` de un
 * canje lo confirma. La dispara el guard de tokens (`token_api_guard.ts`) antes de atender esa
 * llamada, así la llamada ya ve el conector nuevo (por ejemplo, el PUT del contrato). Con una
 * reconexión pendiente aplica el juego nuevo y revoca el `atk_` anterior (`confirmarCanjeIris`).
 * La primera llamada a `POST /integraciones/iris/conexion/revocar` no confirma. El guard solo la
 * llama si el token es de un canje por confirmar (`esCanjeIrisPorConfirmar`), así que casi siempre
 * cambia algo y deja su fila.
 */
export default class ConfirmarCanjeIris extends DomainAction<
    EntradaConfirmarCanjeIris,
    SalidaConfirmarCanjeIris
> {
    readonly nombre = 'iris.confirmar_canje'

    protected async handle(
        input: EntradaConfirmarCanjeIris,
        t: Transaccion,
    ): Promise<SalidaConfirmarCanjeIris> {
        t.fijarEmpresa(null)
        t.fijarEntidad('conector_iris', 1)
        const antes = await bloquearConectorIris(t)
        if (!antes) return { resultado: null }
        return { resultado: await confirmarCanjeIris(t, antes, input.atk_id, null) }
    }
}
