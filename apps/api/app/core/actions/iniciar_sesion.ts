import { DomainAction, type Transaccion } from '#shared/domain_action'
import { CredencialesInvalidas } from '#shared/errores'
import Usuario from '#core/models/usuario'
import { construirMe, type Me } from '#core/acl'

export interface EntradaIniciarSesion {
    email: string
    password: string
}

export interface SalidaIniciarSesion {
    token: string
    /** vencimiento del token (`ACCESS_TOKEN_EXPIRA`); null si no vence */
    expiraEn: Date | null
    usuario: Me
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
        const token = await Usuario.accessTokens.create(usuario, ['*'], { name: `login ${t.ctx.canal}` })
        return {
            token: token.value!.release(),
            expiraEn: token.expiresAt ?? null,
            usuario: await construirMe(usuario),
        }
    }
}
