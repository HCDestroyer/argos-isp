import { randomBytes } from 'node:crypto'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { ContextoAccion } from '#shared/contexto'
import CrearTokenApi from '#core/actions/crear_token_api'
import CrearUsuario from '#core/actions/crear_usuario'
import RevocarTokenApi from '#core/actions/revocar_token_api'

/**
 * Token `atk_` que Argos entrega a Horus en el canje del enlace de conexión (§1.2 y §1.4).
 *
 * Interfaz para no depender de cómo A1 resuelva el usuario técnico "Horus" (fila A5 del
 * contrato). La implementación provisional de abajo se reemplaza con `fijarEmisorTokenHorus`
 * cuando A1 publique la suya (pedido en `.claude/integration/a6.md`).
 */
export interface EmisorTokenHorus {
    /** Emite el token dentro de `trx` (acciones anidadas: auditoría y rollback juntos). */
    emitir(trx: TransactionClientContract, ctx: ContextoAccion): Promise<{ token: string; token_id: number }>
    /** Revoca el token de un canje anterior (best effort, dentro de `trx`). */
    revocar(trx: TransactionClientContract, ctx: ContextoAccion, tokenId: number): Promise<void>
}

/** Permisos del token (§1.2). `sso.emitir` (§1.5) entra solo si ya existe en el ACL (lo agrega A1). */
export const PERMISOS_TOKEN_HORUS = ['ip.resolver', 'clientes.ver', 'servicios.ver', 'sso.emitir'] as const

/** Correo del usuario técnico provisional. */
export const CORREO_USUARIO_HORUS = 'horus@integraciones.argosisp.local'

/**
 * Provisional: usuario técnico `Horus` (rol `soporte`, que tiene los tres permisos de §1.2; el
 * token los recorta a esos) creado con las acciones de A1 si no existe, y token con
 * `CrearTokenApi`.
 */
export const emisorProvisional: EmisorTokenHorus = {
    async emitir(trx, ctx) {
        let usuario = (await trx
            .from('core.usuarios')
            .where('email', CORREO_USUARIO_HORUS)
            .select('id')
            .first()) as {
            id: number
        } | null
        if (!usuario) {
            const rol = (await trx.from('core.roles').where('nombre', 'soporte').select('id').first()) as {
                id: number
            } | null
            const creado = await new CrearUsuario().execute(
                {
                    nombre: 'Horus Flow (integración)',
                    email: CORREO_USUARIO_HORUS,
                    // Nunca inicia sesión con contraseña: solo usa su token.
                    password: randomBytes(32).toString('base64url'),
                    roles: rol ? [{ role_id: Number(rol.id) }] : [],
                },
                ctx,
                { trx },
            )
            usuario = { id: Number(creado.id) }
        }
        const existentes = new Set(
            (
                (await trx
                    .from('core.permisos')
                    .whereIn('nombre', [...PERMISOS_TOKEN_HORUS])
                    .select('nombre')) as Array<{
                    nombre: string
                }>
            ).map((p) => p.nombre),
        )
        const salida = await new CrearTokenApi().execute(
            {
                usuario_id: usuario.id,
                nombre: `Horus Flow (enlace de conexión ${new Date().toISOString().slice(0, 10)})`,
                alcances: { permisos: PERMISOS_TOKEN_HORUS.filter((p) => existentes.has(p)) },
            },
            ctx,
            { trx },
        )
        return { token: salida.token, token_id: Number(salida.datos.id) }
    },
    async revocar(trx, ctx, tokenId) {
        const fila = (await trx
            .from('core.tokens_api')
            .where('id', tokenId)
            .select('revocado_en')
            .first()) as {
            revocado_en: Date | null
        } | null
        if (!fila || fila.revocado_en) return
        await new RevocarTokenApi().execute({ id: tokenId }, ctx, { trx })
    },
}

let emisor: EmisorTokenHorus = emisorProvisional

export function emisorTokenHorus(): EmisorTokenHorus {
    return emisor
}

/** Reemplaza el emisor (A1, o las pruebas). Sin argumento vuelve al provisional. */
export function fijarEmisorTokenHorus(nuevo?: EmisorTokenHorus) {
    emisor = nuevo ?? emisorProvisional
}
