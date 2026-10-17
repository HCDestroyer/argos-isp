import * as z from 'zod'

/**
 * Espejo del validador VineJS de `POST /api/v1/auth/login` (email + password).
 * El tipo de salida debe ser asignable a `CredencialesLogin` del contrato.
 */
export const esquemaLogin = z.object({
    email: z.email('Escribe un correo válido').trim().toLowerCase(),
    password: z.string('La contraseña es obligatoria').min(1, 'La contraseña es obligatoria'),
})

export type DatosLogin = z.output<typeof esquemaLogin>

/** Ventana de bloqueo: el correo es el de la sesión, solo se pide la contraseña. */
export const esquemaDesbloqueo = esquemaLogin.pick({ password: true })

export type DatosDesbloqueo = z.output<typeof esquemaDesbloqueo>
