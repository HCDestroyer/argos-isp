import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado } from '#shared/errores'
import { descifrar } from '#shared/cifrado'

export interface CredencialesPpp {
    servicio_id: number
    user_ppp: string
    pass_ppp: string
}

/**
 * Muestra las credenciales PPPoE en claro (para configurar el CPE). Es una acción, no una
 * lectura: cada consulta queda en `audit.acciones` con actor y canal. La respuesta lleva la
 * contraseña; la entrada auditada no.
 */
export default class VerCredencialesServicio extends DomainAction<{ id: number }, CredencialesPpp> {
    readonly nombre = 'servicios.ver_credenciales'

    protected async handle(input: { id: number }, t: Transaccion): Promise<CredencialesPpp> {
        t.fijarEntidad('servicio', input.id)
        const fila = (await t.trx
            .from('core.servicios')
            .where('id', input.id)
            .select('user_ppp', 'pass_ppp')
            .first()) as { user_ppp: string; pass_ppp: string } | null
        if (!fila) throw new NoEncontrado(`El servicio ${input.id} no existe`)
        return { servicio_id: input.id, user_ppp: fila.user_ppp, pass_ppp: descifrar(fila.pass_ppp) }
    }
}
