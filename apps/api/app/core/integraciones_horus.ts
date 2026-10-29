import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Permiso } from '#core/permisos'
import type { TokenApiVista } from '#core/consultas/acl'
import { tokensUsuarioTecnico, usuarioTecnico, type DefinicionUsuarioTecnico } from '#core/usuario_tecnico'

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

export const USUARIO_TECNICO_HORUS: DefinicionUsuarioTecnico = {
    sistema: 'horus',
    nombre: NOMBRE_USUARIO_HORUS,
    email: EMAIL_USUARIO_HORUS,
    rol: ROL_HORUS,
    descripcionRol: 'Integración Horus Flow: resolver IPs y leer clientes y servicios',
    permisos: PERMISOS_HORUS,
}

/** Id del usuario técnico Horus, o null si nunca se generó un token. */
export function usuarioHorus(cliente: QueryClientContract = db.connection()): Promise<number | null> {
    return usuarioTecnico(EMAIL_USUARIO_HORUS, cliente)
}

/** Tokens del usuario Horus (vigentes y revocados), los más nuevos primero; nunca su valor. */
export function listarTokensHorus(cliente: QueryClientContract = db.connection()): Promise<TokenApiVista[]> {
    return tokensUsuarioTecnico(EMAIL_USUARIO_HORUS, cliente)
}
