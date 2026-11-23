import * as z from 'zod'

export type SistemaEquipos = 'smartolt' | 'genieacs'

const urlOVacia = (ejemplo: string) => z.string().trim().max(500, 'Máximo 500 caracteres')
    .refine(v => v === '' || /^https?:\/\/[^\s/]+/.test(v), `Escribe la dirección completa, p. ej. ${ejemplo}`)
    .transform(v => (v === '' ? null : v))

/**
 * Espejo de `configurarEquiposValidator` (A6): direcciones de hasta 500 caracteres (vacías = sin
 * configurar), usuario de GenieACS de hasta 200, el certificado PEM propio del proxy y los perfiles
 * de autorización de SmartOLT por OLT y plan. Los secretos van aparte (`CampoSecreto`).
 */
export const esquemaEquipos = z.object({
    activo: z.boolean(),
    smartolt_url: urlOVacia('https://miisp.smartolt.com'),
    genieacs_url: urlOVacia('https://acs.miisp.gt:7557'),
    genieacs_usuario: z.string().trim().max(200, 'Máximo 200 caracteres').transform(v => (v === '' ? null : v)),
    pppoe_por_acs: z.boolean(),
    perfiles: z.array(z.object({
        smartolt_olt_id: z.string().trim().min(1, 'Elige la OLT').max(50, 'Máximo 50 caracteres'),
        plan_id: z.number().int().positive().nullable(),
        authorization_preset_id: z.number('Escribe el preset').int('Solo números enteros').min(1, 'Desde 1'),
        pon_type: z.enum(['gpon', 'epon']),
    })).max(500, 'Máximo 500 perfiles'),
})

export type EntradaEquipos = z.input<typeof esquemaEquipos>
export type SalidaEquipos = z.output<typeof esquemaEquipos>

export function entradaEquipos(config: ConfigEquipos): EntradaEquipos {
    return {
        activo: config.activo,
        smartolt_url: config.smartolt.url ?? '',
        genieacs_url: config.genieacs.url ?? '',
        genieacs_usuario: config.genieacs.usuario ?? '',
        pppoe_por_acs: config.pppoe_por_acs,
        perfiles: config.perfiles.map(p => ({ ...p })),
    }
}

/** Un secreto en el cuerpo del PUT: omitido (se conserva), `null` (se borra) o el texto nuevo. */
export function secretoEnCuerpo(secreto: Secreto): string | null | undefined {
    if (secreto.accion === 'borrar') {
        return null
    }
    return secreto.accion === 'reemplazar' && secreto.valor.trim() !== '' ? secreto.valor.trim() : undefined
}

/** Estado de SmartOLT o GenieACS para la lista y la tarjeta: con icono, texto y color. */
export function estadoEquipos(config: ConfigEquipos, sistema: SistemaEquipos): { etiqueta: string, color: 'success' | 'error' | 'warning' | 'neutral', icono: string } {
    const parte = config[sistema]
    if (!parte.url) {
        return { etiqueta: 'Sin conectar', color: 'neutral', icono: 'i-lucide-plug' }
    }
    if (!config.activo) {
        return { etiqueta: 'Apagada', color: 'neutral', icono: 'i-lucide-power-off' }
    }
    if (parte.prueba_ok === true) {
        return { etiqueta: 'Conectado', color: 'success', icono: 'i-lucide-plug-zap' }
    }
    if (parte.prueba_ok === false) {
        return { etiqueta: 'No responde', color: 'error', icono: 'i-lucide-circle-alert' }
    }
    return { etiqueta: 'Sin probar', color: 'warning', icono: 'i-lucide-circle-help' }
}
