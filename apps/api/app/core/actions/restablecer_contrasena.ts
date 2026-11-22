import hash from '@adonisjs/core/services/hash'
import { DomainAction, type Transaccion } from '#shared/domain_action'
import {
    EnlaceRecuperacionInvalido,
    exigirRecuperacionEncendida,
    hashTokenRecuperacion,
} from '#core/auth/recuperacion'

export interface EntradaRestablecerContrasena {
    token: string
    password: string
}

/**
 * Cambia la contraseña con el enlace de recuperación (`auth.restablecer_contrasena`, pública; decisión
 * del PM 22). El token vale una vez y hasta su vencimiento (422 `enlace_invalido`). Cierra todas las
 * sesiones del usuario (tokens de login y del panel), anula otros enlaces pendientes y emite
 * `usuario.contrasena_restablecida`. La auditoría queda con el usuario como actor y sin el token ni la
 * contraseña.
 */
export default class RestablecerContrasena extends DomainAction<
    EntradaRestablecerContrasena,
    { usuario_id: number; sesiones_cerradas: number }
> {
    readonly nombre = 'auth.restablecer_contrasena'
    protected readonly camposEntradaOcultos = ['token', 'password']

    protected async handle(
        input: EntradaRestablecerContrasena,
        t: Transaccion,
    ): Promise<{ usuario_id: number; sesiones_cerradas: number }> {
        await exigirRecuperacionEncendida(t.trx)
        const fila = (await t.trx
            .from('core.recuperaciones_contrasena as r')
            .join('core.usuarios as u', 'u.id', 'r.usuario_id')
            .where('r.token_hash', hashTokenRecuperacion(input.token))
            .whereNull('r.usado_en')
            .whereNull('r.anulado_en')
            .where('r.expira_en', '>', t.trx.knexRawQuery('now()'))
            .where('u.activo', true)
            .forUpdate()
            .select('r.id', 'r.usuario_id', 'u.nombre')
            .first()) as { id: number; usuario_id: number; nombre: string } | null
        if (!fila) throw new EnlaceRecuperacionInvalido()
        const usuarioId = Number(fila.usuario_id)
        t.identificarActor({ tipo: 'usuario', id: usuarioId })
        t.fijarEntidad('usuario', usuarioId)
        t.fijarEmpresa(null)

        await t.trx
            .from('core.usuarios')
            .where('id', usuarioId)
            .update({
                password_hash: await hash.use('scrypt').make(input.password),
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            } as Record<string, unknown>)
        await t.trx
            .from('core.recuperaciones_contrasena')
            .where('id', fila.id)
            .update({ usado_en: t.trx.knexRawQuery('now()') } as Record<string, unknown>)
        await t.trx
            .from('core.recuperaciones_contrasena')
            .where('usuario_id', usuarioId)
            .whereNull('usado_en')
            .whereNull('anulado_en')
            .update({ anulado_en: t.trx.knexRawQuery('now()') } as Record<string, unknown>)
        const cerradas = Number(
            await t.trx.from('core.auth_access_tokens').where('tokenable_id', usuarioId).delete(),
        )
        await t.registrarCambios({ tipo: 'usuario', id: usuarioId }, {}, { clave_cambiada: true })
        await t.emit('usuario.contrasena_restablecida', {
            usuario_id: usuarioId,
            sesiones_cerradas: cerradas,
        })
        return { usuario_id: usuarioId, sesiones_cerradas: cerradas }
    }
}
