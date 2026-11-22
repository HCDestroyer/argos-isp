import { DomainAction, type Transaccion } from '#shared/domain_action'
import { guardarInicioUsuario } from '#billing/panel/inicio_guardar'
import type { Inicio } from '#billing/panel/validators'

export interface EntradaConfigurarInicioUsuario {
    usuario_id: number
    inicio: Inicio | null
    version?: number
}

/**
 * `inicio.configurar_usuario`: el admin elige la pantalla de inicio de otro usuario (decisión 2).
 * Mismas reglas que `inicio.elegir`.
 */
export default class ConfigurarInicioUsuario extends DomainAction<
    EntradaConfigurarInicioUsuario,
    { cambiado: boolean }
> {
    readonly nombre = 'inicio.configurar_usuario'

    protected async handle(input: EntradaConfigurarInicioUsuario, t: Transaccion) {
        return { cambiado: await guardarInicioUsuario(t, input.usuario_id, input.inicio, input.version) }
    }
}
