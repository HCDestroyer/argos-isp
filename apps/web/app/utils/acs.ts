import * as z from 'zod'

/**
 * ACS (GenieACS) de la empresa (tablero `PendAcs`): estado con icono, texto y color y el esquema del
 * formulario, espejo de `configurarAcsValidator`. La clave y el certificado van aparte (`CampoSecreto`).
 */
export function estadoAcs(acs: ConfigAcs): { etiqueta: string, color: 'success' | 'error' | 'neutral' | 'warning', icono: string } {
    if (acs.version === 0 || !acs.url) {
        return { etiqueta: 'Sin configurar', color: 'neutral', icono: 'i-lucide-clock' }
    }
    if (!acs.activo) {
        return { etiqueta: 'Apagado', color: 'neutral', icono: 'i-lucide-power' }
    }
    if (acs.prueba_ok === true) {
        return { etiqueta: 'Probado', color: 'success', icono: 'i-lucide-check' }
    }
    if (acs.prueba_ok === false) {
        return { etiqueta: 'Falla', color: 'error', icono: 'i-lucide-triangle-alert' }
    }
    return { etiqueta: 'Sin probar', color: 'warning', icono: 'i-lucide-clock' }
}

export const esquemaAcs = z.object({
    url: z.string().trim().min(1, 'Escribe la dirección').max(500, 'Máximo 500 caracteres')
        .refine(v => /^https?:\/\/[^\s/]+/.test(v), 'Debe empezar con https://'),
    usuario: z.string().trim().max(200, 'Máximo 200 caracteres'),
    pppoe_por_acs: z.boolean(),
})

export type EntradaAcs = z.input<typeof esquemaAcs>
export type SalidaAcs = z.output<typeof esquemaAcs>

/** Un secreto en el cuerpo del PUT: omitido (se conserva), `null` (se borra) o el texto nuevo. */
export function secretoEnCuerpo(secreto: Secreto): string | null | undefined {
    if (secreto.accion === 'borrar') {
        return null
    }
    return secreto.accion === 'reemplazar' && secreto.valor.trim() !== '' ? secreto.valor.trim() : undefined
}

/** «hoy 08:40 · Ana Cruz», «ayer 17:05» o «Nunca». */
export function cuandoPrueba(probadoEn: string | null, quien: string | null): string {
    if (!probadoEn) {
        return 'Nunca'
    }
    return quien ? `${formatearFechaHora(probadoEn)} · ${quien}` : formatearFechaHora(probadoEn)
}
