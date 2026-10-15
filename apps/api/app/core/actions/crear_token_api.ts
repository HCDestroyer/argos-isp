import { DomainAction, type Transaccion } from '#shared/domain_action'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { generarTokenApi } from '#core/auth/token_api_guard'
import { verToken, type TokenApiVista } from '#core/consultas/acl'
import type { AlcancesToken } from '#core/acl'

export interface EntradaCrearTokenApi {
    usuario_id: number
    nombre: string
    alcances?: AlcancesToken
}

export interface SalidaCrearTokenApi {
    /** valor en claro; solo se devuelve aquí */
    token: string
    datos: TokenApiVista
}

/**
 * Crea un token de API para un usuario (integraciones, agentes de IA). Se guarda solo su sha256;
 * el valor se devuelve una única vez. `alcances.permisos` recorta los permisos del usuario y
 * `routers`/`zonas`/`cajas` restringen su alcance.
 */
export default class CrearTokenApi extends DomainAction<EntradaCrearTokenApi, SalidaCrearTokenApi> {
    readonly nombre = 'tokens.crear'

    protected async handle(input: EntradaCrearTokenApi, t: Transaccion): Promise<SalidaCrearTokenApi> {
        const usuario = await t.trx
            .from('core.usuarios')
            .where('id', input.usuario_id)
            .select('activo')
            .first()
        if (!usuario) throw new NoEncontrado(`El usuario ${input.usuario_id} no existe`)

        const alcances = input.alcances ?? {}
        if (alcances.permisos) {
            const conocidos = new Set(
                (
                    (await t.trx
                        .from('core.permisos')
                        .whereIn('nombre', alcances.permisos)
                        .select('nombre')) as Array<{
                        nombre: string
                    }>
                ).map((p) => p.nombre),
            )
            const desconocidos = alcances.permisos.filter((p) => !conocidos.has(p))
            if (desconocidos.length > 0) {
                throw new ValidacionFallida(
                    desconocidos.map((p) => ({
                        field: 'alcances.permisos',
                        message: `Permiso desconocido: ${p}`,
                        rule: 'exists',
                    })),
                )
            }
        }

        const { valor, hash } = generarTokenApi()
        const [fila] = (await t.trx
            .insertQuery()
            .table('core.tokens_api')
            .insert({
                usuario_id: input.usuario_id,
                nombre: input.nombre,
                hash,
                alcances: JSON.stringify(alcances),
            })
            .returning('id')) as Array<{ id: number }>
        const id = fila!.id
        t.fijarEntidad('token_api', id)

        const datos = await verToken(id, t.trx)
        await t.registrarCambios({ tipo: 'token_api', id }, null, {
            usuario_id: datos.usuario_id,
            nombre: datos.nombre,
            alcances: datos.alcances,
        })
        return { token: valor, datos }
    }
}
