import { DomainAction, type Transaccion } from '#shared/domain_action'
import { ConflictoVersion, NoEncontrado } from '#shared/errores'
import { inicioDeFabrica, inicioDeRoles, type InicioRol } from '#billing/panel/inicio'
import type { Inicio } from '#billing/panel/validators'

export interface EntradaConfigurarInicioRol {
    role_id: number
    /** null = volver al de fábrica (admin y dueño: panel financiero; los demás: día a día) */
    inicio: Inicio | null
    version?: number
}

/**
 * `inicio.configurar_rol` (decisión 2 del PM): pantalla de inicio de los usuarios de un rol que no
 * eligieron la suya. Diff en `audit.cambios` (`rol`, campo `inicio`) e `inicio.cambiado`.
 */
export default class ConfigurarInicioRol extends DomainAction<EntradaConfigurarInicioRol, InicioRol> {
    readonly nombre = 'inicio.configurar_rol'

    protected async handle(input: EntradaConfigurarInicioRol, t: Transaccion): Promise<InicioRol> {
        const rol = (await t.trx
            .from('core.roles')
            .where('id', input.role_id)
            .select('id', 'nombre')
            .first()) as {
            id: number
            nombre: string
        } | null
        if (!rol) throw new NoEncontrado(`El rol ${input.role_id} no existe`)
        t.fijarEntidad('rol', input.role_id)
        t.fijarEmpresa(null)
        const antes = (await t.trx
            .from('billing.inicio_roles')
            .where('role_id', input.role_id)
            .forUpdate()
            .first()) as { inicio: Inicio; version: number } | null
        if (antes && input.version !== undefined && Number(antes.version) !== input.version) {
            throw new ConflictoVersion('inicio_rol', input.role_id)
        }
        const efectivoAntes = antes?.inicio ?? inicioDeFabrica(rol.nombre)
        const efectivoDespues = input.inicio ?? inicioDeFabrica(rol.nombre)
        const guardadoAntes = antes?.inicio ?? null
        if (guardadoAntes !== input.inicio) {
            if (input.inicio === null) {
                await t.trx.from('billing.inicio_roles').where('role_id', input.role_id).delete()
            } else if (antes) {
                await t.trx
                    .from('billing.inicio_roles')
                    .where('role_id', input.role_id)
                    .update({
                        inicio: input.inicio,
                        version: t.trx.knexRawQuery('version + 1'),
                        updated_at: t.trx.knexRawQuery('now()'),
                    })
            } else {
                await t.trx
                    .table('billing.inicio_roles')
                    .insert({ role_id: input.role_id, inicio: input.inicio })
            }
            await t.registrarCambios(
                { tipo: 'rol', id: input.role_id },
                { inicio: guardadoAntes },
                { inicio: input.inicio },
            )
            if (efectivoAntes !== efectivoDespues || guardadoAntes !== input.inicio) {
                await t.emit('inicio.cambiado', {
                    alcance: 'rol',
                    role_id: input.role_id,
                    usuario_id: null,
                    de: efectivoAntes,
                    a: efectivoDespues,
                })
            }
        }
        const [resultado] = await inicioDeRoles(t.trx, [input.role_id])
        return resultado!
    }
}
