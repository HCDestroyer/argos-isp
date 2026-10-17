import type { DateTime } from 'luxon'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { BaseModel, column } from '@adonisjs/lucid/orm'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import env from '#start/env'

/** Tabla, tipo y prefijo de los tokens de sesión (también los lee el guard `panel`). */
export const TOKENS_SESION = { tabla: 'core.auth_access_tokens', tipo: 'sesion', prefijo: 'oat_' } as const

const AuthFinder = withAuthFinder(() => hash.use('scrypt'), {
    uids: ['email'],
    passwordColumnName: 'password',
})

/**
 * Usuario del sistema (`core.usuarios`). Tokens de API y agentes de IA también son usuarios.
 * `password` se guarda hasheado en la columna `password_hash` (lo hace el mixin al guardar).
 */
export default class Usuario extends compose(BaseModel, AuthFinder) {
    static table = 'core.usuarios'

    @column({ isPrimary: true })
    declare id: number

    @column()
    declare nombre: string

    @column()
    declare email: string

    @column({ columnName: 'password_hash', serializeAs: null })
    declare password: string

    @column()
    declare activo: boolean

    @column()
    declare version: number

    @column.dateTime({ autoCreate: true })
    declare createdAt: DateTime

    @column.dateTime({ autoCreate: true, autoUpdate: true })
    declare updatedAt: DateTime

    /** Sesiones de login (tokens opacos `oat_...`) en `core.auth_access_tokens`. */
    static accessTokens = DbAccessTokensProvider.forModel(Usuario, {
        table: TOKENS_SESION.tabla,
        type: TOKENS_SESION.tipo,
        prefix: TOKENS_SESION.prefijo,
        expiresIn: env.get('ACCESS_TOKEN_EXPIRA') ?? '12h',
    })
}
