import { createHash, randomBytes } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { errors, symbols } from '@adonisjs/auth'
import type { AuthClientResponse, GuardContract } from '@adonisjs/auth/types'
import Usuario from '#core/models/usuario'
import type { AlcancesToken } from '#core/acl'

/**
 * Tokens de API (`core.tokens_api`): `Authorization: Bearer atk_...`.
 *
 * Solo se guarda el sha256 del token; el valor se muestra una vez al crearlo. Un token es su
 * usuario con alcances acotados (ver `app/core/acl.ts`) y pasa por el mismo ACL. Revocado o con
 * el usuario desactivado → 401.
 */
export const PREFIJO_TOKEN_API = 'atk_'

export function generarTokenApi(): { valor: string; hash: string } {
    const valor = PREFIJO_TOKEN_API + randomBytes(32).toString('base64url')
    return { valor, hash: hashTokenApi(valor) }
}

export function hashTokenApi(valor: string): string {
    return createHash('sha256').update(valor).digest('hex')
}

export interface TokenApiActual {
    id: number
    usuarioId: number
    nombre: string
    alcances: AlcancesToken
}

export class TokenApiGuard implements GuardContract<Usuario> {
    declare [symbols.GUARD_KNOWN_EVENTS]: {}

    readonly driverName = 'token_api' as const

    user?: Usuario
    token?: TokenApiActual
    isAuthenticated = false
    authenticationAttempted = false

    constructor(private ctx: HttpContext) {}

    getUserOrFail(): Usuario {
        if (!this.user) {
            throw new errors.E_UNAUTHORIZED_ACCESS('Unauthorized access', {
                guardDriverName: this.driverName,
            })
        }
        return this.user
    }

    async authenticate(): Promise<Usuario> {
        if (this.authenticationAttempted) return this.getUserOrFail()
        this.authenticationAttempted = true

        const header = this.ctx.request.header('authorization') ?? ''
        const valor = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : ''
        if (!valor.startsWith(PREFIJO_TOKEN_API)) return this.getUserOrFail()

        const fila = (await db
            .from('core.tokens_api')
            .where('hash', hashTokenApi(valor))
            .whereNull('revocado_en')
            .select('id', 'usuario_id', 'nombre', 'alcances')
            .first()) as { id: number; usuario_id: number; nombre: string; alcances: AlcancesToken } | null
        if (!fila) return this.getUserOrFail()

        const usuario = await Usuario.find(fila.usuario_id)
        if (!usuario) return this.getUserOrFail()

        // Se actualiza como mucho una vez por minuto para no escribir en cada petición.
        await db
            .from('core.tokens_api')
            .where('id', fila.id)
            .where((q) => q.whereNull('ultimo_uso').orWhereRaw(`ultimo_uso < now() - interval '1 minute'`))
            .update({ ultimo_uso: db.knexRawQuery('now()') })

        this.user = usuario
        this.token = { id: fila.id, usuarioId: fila.usuario_id, nombre: fila.nombre, alcances: fila.alcances }
        this.isAuthenticated = true
        return usuario
    }

    async check(): Promise<boolean> {
        try {
            await this.authenticate()
            return true
        } catch (error) {
            if (error instanceof errors.E_UNAUTHORIZED_ACCESS) return false
            throw error
        }
    }

    async authenticateAsClient(): Promise<AuthClientResponse> {
        throw new Error('Para pruebas crea un token con generarTokenApi() y úsalo como Bearer')
    }
}
