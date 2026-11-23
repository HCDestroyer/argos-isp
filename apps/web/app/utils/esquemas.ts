import * as z from 'zod'

/**
 * Espejo del validador VineJS de `POST /api/v1/auth/login` (email + password).
 * El tipo de salida debe ser asignable a `CredencialesLogin` del contrato.
 */
export const esquemaLogin = z.object({
    email: z.email('Escribe un correo válido').trim().toLowerCase(),
    password: z.string('Escribe tu contraseña').min(1, 'Escribe tu contraseña'),
})

export type DatosLogin = z.output<typeof esquemaLogin>

/** Ventana de bloqueo: el correo es el de la sesión, solo se pide la contraseña. */
export const esquemaDesbloqueo = esquemaLogin.pick({ password: true })

export type DatosDesbloqueo = z.output<typeof esquemaDesbloqueo>

/** Espejo de `POST /auth/recuperar-contrasena` (A1): un correo de hasta 200 caracteres. */
export const esquemaRecuperarContrasena = z.object({
    email: z.email('Escribe un correo válido').trim().toLowerCase().max(200, 'Máximo 200 caracteres'),
})

export type DatosRecuperarContrasena = z.output<typeof esquemaRecuperarContrasena>

/**
 * Espejo de `POST /auth/restablecer-contrasena` (A1): la contraseña nueva de 8 a 200 caracteres. La
 * repetición solo existe en el panel (no se envía).
 */
export const esquemaRestablecerContrasena = z.object({
    password: z.string('Escribe la contraseña nueva').min(8, 'Al menos 8 caracteres').max(200, 'Máximo 200 caracteres'),
    repetir: z.string('Escríbela otra vez'),
}).refine(d => d.password === d.repetir, { path: ['repetir'], message: 'No coincide con la contraseña nueva' })

export type DatosRestablecerContrasena = z.output<typeof esquemaRestablecerContrasena>
