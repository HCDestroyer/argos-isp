import { DomainAction, type Transaccion } from '#shared/domain_action'
import { CredencialesInvalidas } from '#shared/errores'
import Usuario from '#core/models/usuario'
import { construirMe, type Me } from '#core/acl'
import { NOMBRE_TOKEN_PANEL, configSesionPanel, topeDeSesion } from '#core/auth/sesion_deslizante'

export interface EntradaIniciarSesion {
    email: string
    password: string
    /**
     * `cookie`: sesión del panel (`POST /auth/sesion`), con vencimiento deslizante
     * (`app/core/auth/sesion_deslizante.ts`). Por defecto `bearer`: vence a `ACCESS_TOKEN_EXPIRA`.
     */
    modo?: 'bearer' | 'cookie'
}

export interface SalidaIniciarSesion {
    token: string
    /** vencimiento del token (`ACCESS_TOKEN_EXPIRA`); null si no vence */
    expiraEn: Date | null
    /** tope absoluto: igual a `expiraEn` con Bearer; `login + PANEL_SESION_MAXIMA_H` con la cookie */
    expiraMaxEn: Date | null
    usuario: Me
}

/**
 * Emite el token de sesión de un usuario ya verificado: `cookie` (panel, vencimiento deslizante y
 * tope de 72 h) o `bearer`. La usan el login y el autologin por ticket (`auth.sso_canjear`), así
 * una sesión abierta desde otro sistema tiene exactamente los mismos límites.
 */
export async function emitirSesion(
    usuario: Usuario,
    modo: 'bearer' | 'cookie',
    canal: string,
): Promise<SalidaIniciarSesion> {
    if (modo === 'cookie') {
        const cfg = configSesionPanel()
        const token = await Usuario.accessTokens.create(usuario, ['*'], {
            name: NOMBRE_TOKEN_PANEL,
            expiresIn: Math.floor(cfg.inactividadMs / 1000),
        })
        return {
            token: token.value!.release(),
            expiraEn: token.expiresAt ?? null,
            expiraMaxEn: topeDeSesion(token.createdAt, cfg),
            usuario: await construirMe(usuario),
        }
    }
    const token = await Usuario.accessTokens.create(usuario, ['*'], { name: `login ${canal}` })
    return {
        token: token.value!.release(),
        expiraEn: token.expiresAt ?? null,
        expiraMaxEn: token.expiresAt ?? null,
        usuario: await construirMe(usuario),
    }
}

/**
 * Login: verifica credenciales y emite un token opaco de sesión. La ruta lo entrega como Bearer
 * (`POST /auth/login`) o en la cookie `HttpOnly` del panel (`POST /auth/sesion`).
 * La contraseña nunca llega a la auditoría (se enmascara como `***`). Un login correcto queda
 * en `audit.acciones` con el actor = usuario que entró; uno fallido, con actor `sistema`.
 */
export default class IniciarSesion extends DomainAction<EntradaIniciarSesion, SalidaIniciarSesion> {
    readonly nombre = 'auth.login'

    protected async handle(input: EntradaIniciarSesion, t: Transaccion): Promise<SalidaIniciarSesion> {
        let usuario: Usuario
        try {
            usuario = await Usuario.verifyCredentials(input.email.toLowerCase(), input.password)
        } catch {
            throw new CredencialesInvalidas()
        }
        if (!usuario.activo) throw new CredencialesInvalidas()

        t.fijarEntidad('usuario', usuario.id)
        // la petición llega anónima: el login queda auditado con el usuario que entró
        t.identificarActor({ tipo: 'usuario', id: usuario.id })
        return emitirSesion(usuario, input.modo ?? 'bearer', t.ctx.canal)
    }
}
