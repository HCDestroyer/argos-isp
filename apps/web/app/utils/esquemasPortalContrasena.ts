import * as z from 'zod'

/**
 * Espejo de `configurarContrasenaDefectoValidator` (apps/api/app/portal/validators.ts):
 * `contrasena` de 8 a 128 caracteres, sin recortar espacios (VineJS no la recorta). La
 * confirmación solo existe en el panel y no viaja a la API.
 */
export const MIN_CONTRASENA_PORTAL = 8
export const MAX_CONTRASENA_PORTAL = 128

export const esquemaContrasenaDefecto = z.object({
    contrasena: z.string()
        .min(MIN_CONTRASENA_PORTAL, `Al menos ${MIN_CONTRASENA_PORTAL} caracteres`)
        .max(MAX_CONTRASENA_PORTAL, `Máximo ${MAX_CONTRASENA_PORTAL} caracteres`),
    confirmacion: z.string().min(1, 'Escríbela otra vez para confirmarla'),
}).refine(datos => datos.contrasena === datos.confirmacion, { path: ['confirmacion'], message: 'No coincide con la contraseña' })

export type EntradaContrasenaDefecto = z.input<typeof esquemaContrasenaDefecto>
export type SalidaContrasenaDefecto = z.output<typeof esquemaContrasenaDefecto>

/** Estado de la contraseña por defecto en una frase (página de configuración). */
export function textoEstadoDefecto(defecto: { configurada: boolean, actualizada_en: string | null }, fecha: (iso: string) => string): string {
    if (!defecto.configurada) {
        return 'Sin configurar: los clientes sin contraseña propia solo pueden entrar con código.'
    }
    return defecto.actualizada_en ? `Configurada el ${fecha(defecto.actualizada_en)}.` : 'Configurada.'
}

/** Aviso emergente de «Restaurar contraseña por defecto» con las sesiones que cerró. */
export function textoSesionesCerradas(cerradas: number): string {
    if (cerradas === 0) {
        return 'No tenía sesiones abiertas en el portal.'
    }
    return cerradas === 1 ? 'Se cerró 1 sesión del portal.' : `Se cerraron ${cerradas} sesiones del portal.`
}
