import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Permiso } from '#core/permisos'
import type { TokenApiVista } from '#core/consultas/acl'

/**
 * Integración con Horus Flow (contrato `.claude/integration/contratos/horus.md` §1.2): un usuario
 * técnico "Horus" con un rol propio y tokens `atk_` de alcance mínimo. El conector viene apagado:
 * sin token generado, Horus no puede leer nada y Argos no depende de él.
 */

/** Correo del usuario técnico (no es un buzón: nadie inicia sesión con él). */
export const EMAIL_USUARIO_HORUS = 'horus@integraciones.argosisp.local'
export const NOMBRE_USUARIO_HORUS = 'Horus'
/** Rol del usuario técnico; el token recorta además sus permisos a `PERMISOS_HORUS`. */
export const ROL_HORUS = 'integracion_horus'
export const PERMISOS_HORUS = [
    'ip.resolver',
    'clientes.ver',
    'servicios.ver',
    'sso.emitir',
] as const satisfies readonly Permiso[]

/** Id del usuario técnico Horus, o null si nunca se generó un token. */
export async function usuarioHorus(cliente: QueryClientContract = db.connection()): Promise<number | null> {
    const fila = (await cliente
        .from('core.usuarios')
        .whereRaw('lower(email) = ?', [EMAIL_USUARIO_HORUS])
        .select('id')
        .first()) as { id: number } | null
    return fila ? Number(fila.id) : null
}

/** Tokens del usuario Horus (vigentes y revocados), los más nuevos primero; nunca su valor. */
export async function listarTokensHorus(
    cliente: QueryClientContract = db.connection(),
): Promise<TokenApiVista[]> {
    const usuarioId = await usuarioHorus(cliente)
    if (usuarioId === null) return []
    return (await cliente
        .from('core.tokens_api')
        .where('usuario_id', usuarioId)
        .select('id', 'usuario_id', 'nombre', 'alcances', 'ultimo_uso', 'revocado_en', 'created_at')
        .orderBy('id', 'desc')) as TokenApiVista[]
}
