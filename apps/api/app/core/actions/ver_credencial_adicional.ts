import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ReglaNegocio } from '#shared/errores'
import { exigirAccesoEmpresa } from '#shared/empresa_activa'
import { descifrar } from '#shared/cifrado'

export interface CredencialAdicional {
    servicio_id: number
    asignacion_id: number
    identificador: string | null
    credencial: string
}

/**
 * Muestra en claro la credencial de un adicional de un servicio
 * (`servicios.ver_credencial_adicional`), igual que `servicios.ver_credenciales` con la contraseña
 * PPPoE: es una acción, no una lectura, y cada consulta queda en `audit.acciones` con actor y
 * canal. La entrada auditada no lleva la credencial. Sin credencial: 422 `sin_credencial`.
 */
export default class VerCredencialAdicional extends DomainAction<
    { servicio_id: number; id: number },
    CredencialAdicional
> {
    readonly nombre = 'servicios.ver_credencial_adicional'

    protected async handle(
        input: { servicio_id: number; id: number },
        t: Transaccion,
    ): Promise<CredencialAdicional> {
        t.fijarEntidad('servicio', input.servicio_id)
        const fila = (await t.trx
            .from('core.servicios_adicionales')
            .where('id', input.id)
            .where('servicio_id', input.servicio_id)
            .select('empresa_id', 'identificador', 'credencial')
            .first()) as {
            empresa_id: number
            identificador: string | null
            credencial: string | null
        } | null
        if (!fila) {
            throw new NoEncontrado(
                `El servicio ${input.servicio_id} no tiene el adicional asignado ${input.id}`,
            )
        }
        t.fijarEmpresa(Number(fila.empresa_id))
        exigirAccesoEmpresa(t.ctx, Number(fila.empresa_id))
        if (!fila.credencial) throw new ReglaNegocio('El adicional no tiene credencial', 'sin_credencial')
        return {
            servicio_id: input.servicio_id,
            asignacion_id: input.id,
            identificador: fila.identificador,
            credencial: descifrar(fila.credencial),
        }
    }
}
