import { z } from 'zod'

/**
 * Esquemas de los formularios de la integración con Horus, espejo de los validadores de la API:
 * `configurarHorusValidator`, `conectarConEnlaceValidator` (`app/integraciones/horus/validators.ts`)
 * y `generarTokenHorusValidator`, `vincularCuentaSsoValidator` (`app/core/validators.ts`).
 * Que la URL sea `https` lo decide la API (en laboratorio acepta `http`): aquí solo se pide el esquema.
 */

const url = (maximo: number) => z.string().trim().max(maximo, `Máximo ${maximo} caracteres`).refine(
    valor => valor === '' || /^https?:\/\/\S+$/.test(valor),
    'Escribe la URL completa, con https://',
)

/** Conexión manual (§1.1–§1.3): los secretos van aparte, con `CampoSecreto`. */
export const esquemaConectorHorus = z.object({
    url_base: url(500),
    webhook_salida_url: url(500),
    // `ConfigurarHorus`: `hf_pat_` + 16 o más letras y números; el secreto, 16 o más caracteres.
    token: z.string().trim().max(200, 'Máximo 200 caracteres').refine(
        valor => valor === '' || /^hf_pat_[A-Za-z0-9]{16,}$/.test(valor),
        'El código de conexión de Horus empieza con hf_pat_',
    ),
    webhook_salida_secreto: z.string().trim().max(500, 'Máximo 500 caracteres').refine(
        valor => valor === '' || valor.length >= 16,
        'El secreto del receptor de Horus tiene al menos 16 caracteres',
    ),
})

export type DatosConectorHorus = z.output<typeof esquemaConectorHorus>

/** "Conectar con un enlace de Horus" (§1.4): `https://<horus>/conectar#<código>`. */
export const esquemaEnlaceHorus = z.object({
    enlace: z.string().trim()
        .min(1, 'Pega el enlace que generó Horus')
        .max(1000, 'Máximo 1000 caracteres')
        .regex(/^https?:\/\/[^\s#]+\/conectar#\S+$/, 'Se espera https://<horus>/conectar#<código>'),
})

export type DatosEnlaceHorus = z.output<typeof esquemaEnlaceHorus>

/** "Generar token para Horus": el nombre es opcional (2 a 100 caracteres). */
export const esquemaTokenHorus = z.object({
    nombre: z.string().trim().max(100, 'Máximo 100 caracteres').refine(
        valor => valor === '' || valor.length >= 2,
        'Mínimo 2 caracteres',
    ),
})

export type DatosTokenHorusFormulario = z.output<typeof esquemaTokenHorus>
