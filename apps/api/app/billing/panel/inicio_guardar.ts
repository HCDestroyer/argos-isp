import type { Transaccion } from '#shared/domain_action'
import { ConflictoVersion, NoEncontrado, ReglaNegocio } from '#shared/errores'
import { permisosDeUsuario } from '#core/acl'
import type { Inicio } from '#billing/panel/validators'

/**
 * Guarda (o quita, con `inicio = null`) la pantalla de inicio de un usuario dentro de la acción que
 * la llama (`inicio.elegir` o `inicio.configurar_usuario`): diff en `audit.cambios` (`usuario`,
 * campo `inicio`) y `inicio.cambiado` por outbox. Sin cambio no escribe ni emite.
 */
export async function guardarInicioUsuario(
    t: Transaccion,
    usuarioId: number,
    inicio: Inicio | null,
    version?: number,
): Promise<boolean> {
    const usuario = await t.trx.from('core.usuarios').where('id', usuarioId).select('id').first()
    if (!usuario) throw new NoEncontrado(`El usuario ${usuarioId} no existe`)
    t.fijarEntidad('usuario', usuarioId)
    t.fijarEmpresa(null)
    const permisos = inicio === 'panel_financiero' ? await permisosDeUsuario(usuarioId) : []
    if (inicio === 'panel_financiero' && !permisos.includes('panel_financiero.ver')) {
        throw new ReglaNegocio(
            'El usuario no tiene el permiso panel_financiero.ver: su inicio solo puede ser «Día a día»',
            'inicio_sin_permiso',
        )
    }
    const antes = (await t.trx
        .from('billing.inicio_usuarios')
        .where('usuario_id', usuarioId)
        .forUpdate()
        .first()) as { inicio: Inicio; version: number } | null
    if (antes && version !== undefined && Number(antes.version) !== version) {
        throw new ConflictoVersion('inicio_usuario', usuarioId)
    }
    const de = antes?.inicio ?? null
    if (de === inicio) return false
    if (inicio === null) {
        await t.trx.from('billing.inicio_usuarios').where('usuario_id', usuarioId).delete()
    } else if (antes) {
        await t.trx
            .from('billing.inicio_usuarios')
            .where('usuario_id', usuarioId)
            .update({
                inicio,
                version: t.trx.knexRawQuery('version + 1'),
                updated_at: t.trx.knexRawQuery('now()'),
            })
    } else {
        await t.trx.table('billing.inicio_usuarios').insert({ usuario_id: usuarioId, inicio })
    }
    await t.registrarCambios({ tipo: 'usuario', id: usuarioId }, { inicio: de }, { inicio })
    await t.emit('inicio.cambiado', {
        alcance: 'usuario',
        role_id: null,
        usuario_id: usuarioId,
        de,
        a: inicio,
    })
    return true
}
