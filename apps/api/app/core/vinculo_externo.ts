import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { CONECTORES_SSO, type ConectorSso } from '#core/sso'

/**
 * Resolución de un usuario de otro sistema (Horus, Iris) al usuario local de Argos con el que está
 * vinculado (`core.vinculaciones_externas`). Es el **único** lugar que traduce un id externo a un
 * usuario local: lo usan el canje del autologin (`CanjearTicketSso`) y la actuación de un operador
 * de Iris como su usuario vinculado (`#core/actuacion_vinculada`, Iris 0.7.0 A23).
 *
 * Si cambia cómo Iris identifica a su operador (qué id viaja en `X-Iris-Actor` y dónde se guarda el
 * vínculo), se cambia solo `resolverActorIris` / `usuarioVinculado`; el resto del mecanismo no
 * depende del formato.
 */

/**
 * ¿El conector sigue conectado? Conocido (`CONECTORES_SSO`) y con su token de integración
 * (`core.tokens_api.id`) sin revocar. Lo usan el canje del autologin (con el token que emitió el
 * ticket) y la actuación vinculada (con el token de la petición).
 */
export async function conectorVigente(
    conector: string,
    tokenApiId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<boolean> {
    if (!(CONECTORES_SSO as readonly string[]).includes(conector)) return false
    const token = await cliente
        .from('core.tokens_api')
        .where('id', tokenApiId)
        .whereNull('revocado_en')
        .select('id')
        .first()
    return Boolean(token)
}

export interface UsuarioVinculado {
    /** `core.vinculaciones_externas.id` */
    vinculacionId: number
    /** `core.usuarios.id` del usuario local */
    usuarioId: number
    /** `core.usuarios.activo` */
    activo: boolean
}

/**
 * Vinculación vigente (`revocada_en IS NULL`) de `(conector, id_externo)` con su usuario local, o
 * null si no hay. No mira si el usuario está activo: lo devuelve en `activo` para que cada llamador
 * responda con su propio error.
 */
export async function usuarioVinculado(
    conector: ConectorSso,
    idExterno: string,
    cliente: QueryClientContract = db.connection(),
): Promise<UsuarioVinculado | null> {
    const fila = (await cliente
        .from('core.vinculaciones_externas as v')
        .join('core.usuarios as u', 'u.id', 'v.usuario_id')
        .where('v.conector', conector)
        .where('v.id_externo', idExterno)
        .whereNull('v.revocada_en')
        .select('v.id', 'v.usuario_id', 'u.activo')
        .first()) as { id: number; usuario_id: number; activo: boolean } | null
    if (!fila) return null
    return { vinculacionId: Number(fila.id), usuarioId: Number(fila.usuario_id), activo: fila.activo }
}

/** Prefijo de `X-Iris-Actor` para un operador humano de Iris. */
export const PREFIJO_ACTOR_USUARIO_IRIS = 'usuario:'

/**
 * Id externo de Iris de un `X-Iris-Actor` ya validado (`usuario:<id>` → `<id>`), o null si el
 * actor no es un operador humano (`asistente_ia`).
 *
 * Hoy es el mismo id que Iris manda como `usuario_id_externo` en el ticket de autologin.
 */
export function idExternoDeActorIris(actor: string): string | null {
    if (!actor.startsWith(PREFIJO_ACTOR_USUARIO_IRIS)) return null
    const id = actor.slice(PREFIJO_ACTOR_USUARIO_IRIS.length)
    return id === '' ? null : id
}

/**
 * Usuario local vinculado al operador de Iris de `X-Iris-Actor`, o null si el actor no es un
 * operador (`asistente_ia`) o no tiene vinculación vigente.
 */
export async function resolverActorIris(
    actor: string,
    cliente: QueryClientContract = db.connection(),
): Promise<UsuarioVinculado | null> {
    const idExterno = idExternoDeActorIris(actor)
    if (idExterno === null) return null
    return usuarioVinculado('iris', idExterno, cliente)
}
