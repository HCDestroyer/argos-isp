import { z } from 'zod'

/**
 * Esquemas de los formularios del conector Iris, espejo de `configurarIrisValidator`
 * (`app/integraciones/iris/validators.ts`), de las reglas de `ConfigurarIris` (token
 * `iris_pat_` + 16 o más letras y números, secreto de 16 o más) y de `generarTokenIrisValidator`
 * (`app/core/validators.ts`). Que la URL sea `https` lo decide la API (`IRIS_PERMITIR_HTTP` en
 * laboratorio): aquí solo se pide el esquema.
 */

const url = (maximo: number) => z.string().trim().max(maximo, `Máximo ${maximo} caracteres`).refine(
    valor => valor === '' || /^https?:\/\/\S+$/.test(valor),
    'Escribe la URL completa, con https://',
)

/** Configuración a mano: los secretos van aparte, con `CampoSecreto`. */
export const esquemaConectorIris = z.object({
    url_base: url(500),
    webhook_salida_url: url(500),
    token: z.string().trim().max(500, 'Máximo 500 caracteres').refine(
        valor => valor === '' || /^iris_pat_[A-Za-z0-9]{16,}$/.test(valor),
        'El token de Iris empieza con iris_pat_',
    ),
    webhook_salida_secreto: z.string().trim().max(500, 'Máximo 500 caracteres').refine(
        valor => valor === '' || valor.length >= 16,
        'El secreto del receptor de Iris tiene al menos 16 caracteres',
    ),
})

export type DatosConectorIris = z.output<typeof esquemaConectorIris>

/** "Generar token para Iris": el nombre es opcional (2 a 100 caracteres). */
export const esquemaTokenIris = z.object({
    nombre: z.string().trim().max(100, 'Máximo 100 caracteres').refine(
        valor => valor === '' || valor.length >= 2,
        'Mínimo 2 caracteres',
    ),
})

export type DatosTokenIrisFormulario = z.output<typeof esquemaTokenIris>
