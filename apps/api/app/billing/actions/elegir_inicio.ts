import { DomainAction, type Transaccion } from '#shared/domain_action'
import { guardarInicioUsuario } from '#billing/panel/inicio_guardar'
import type { Inicio } from '#billing/panel/validators'

export interface EntradaElegirInicio {
    /** el usuario de la sesión (nunca otro) */
    usuario_id: number
    inicio: Inicio | null
    version?: number
}

/**
 * `inicio.elegir`: el propio usuario elige su pantalla de inicio (decisión 2 del PM). Como los
 * accesos rápidos, es una preferencia propia: no lleva permiso del ACL. El panel financiero exige
 * `panel_financiero.ver` (422 `inicio_sin_permiso`). `null` vuelve a la de su rol.
 */
export default class ElegirInicio extends DomainAction<EntradaElegirInicio, { cambiado: boolean }> {
    readonly nombre = 'inicio.elegir'

    protected async handle(input: EntradaElegirInicio, t: Transaccion) {
        return { cambiado: await guardarInicioUsuario(t, input.usuario_id, input.inicio, input.version) }
    }
}
