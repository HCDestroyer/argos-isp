/**
 * Schemas de respuesta del OpenAPI (JSON Schema 2020-12 / OpenAPI 3.1).
 *
 * Cada módulo declara los suyos con `definirEsquema('Cliente', {...})`, que devuelve un `$ref`
 * para usar en `respuesta.esquema` de la ruta. El generador los emite en `components.schemas`
 * ordenados por nombre.
 */

export type EsquemaJson = { [clave: string]: unknown }

const registro = new Map<string, EsquemaJson>()

export function ref(nombre: string): EsquemaJson {
    return { $ref: `#/components/schemas/${nombre}` }
}

export function definirEsquema(nombre: string, esquema: EsquemaJson): EsquemaJson {
    const previo = registro.get(nombre)
    if (previo && JSON.stringify(previo) !== JSON.stringify(esquema)) {
        throw new Error(`El esquema ${nombre} ya está definido con otro contenido`)
    }
    registro.set(nombre, esquema)
    return ref(nombre)
}

export function esquemasRegistrados(): Record<string, EsquemaJson> {
    return Object.fromEntries([...registro.entries()].sort(([a], [b]) => a.localeCompare(b, 'en')))
}

/*
|--------------------------------------------------------------------------
| Constructores de tipos frecuentes
|--------------------------------------------------------------------------
*/

export const id: EsquemaJson = { type: 'integer', minimum: 1 }
export const texto: EsquemaJson = { type: 'string' }
export const booleano: EsquemaJson = { type: 'boolean' }
export const entero: EsquemaJson = { type: 'integer' }
export const fecha: EsquemaJson = { type: 'string', format: 'date' }
export const instante: EsquemaJson = { type: 'string', format: 'date-time' }
export const jsonLibre: EsquemaJson = { type: 'object', additionalProperties: true }

export function nulable(esquema: EsquemaJson): EsquemaJson {
    if (typeof esquema.type === 'string') return { ...esquema, type: [esquema.type, 'null'] }
    return { anyOf: [esquema, { type: 'null' }] }
}

export function lista(items: EsquemaJson): EsquemaJson {
    return { type: 'array', items }
}

export function enumerado(valores: readonly string[]): EsquemaJson {
    return { type: 'string', enum: [...valores] }
}

/**
 * Objeto con todas sus propiedades requeridas (las opcionales se marcan nulables).
 * Mantener las respuestas "cerradas" simplifica los tipos del frontend.
 */
export function objeto(propiedades: Record<string, EsquemaJson>, opcionales: string[] = []): EsquemaJson {
    return {
        type: 'object',
        required: Object.keys(propiedades).filter((p) => !opcionales.includes(p)),
        properties: propiedades,
    }
}

/** Página de la paginación por cursor: `{ data: T[], nextCursor }`. */
export function pagina(items: EsquemaJson): EsquemaJson {
    return objeto({ data: lista(items), nextCursor: { type: ['string', 'null'] } })
}

/** Ids de entidad, montos y timestamps comunes a las entidades editables. */
export const auditable = {
    version: { type: 'integer', minimum: 1, description: 'Control optimista: envíala al editar' },
    created_at: instante,
    updated_at: instante,
}

/*
|--------------------------------------------------------------------------
| Schemas comunes
|--------------------------------------------------------------------------
*/

/** Monto decimal como string, p. ej. "150.00". Nunca number. */
export const Dinero = definirEsquema('Dinero', {
    type: 'string',
    pattern: '^-?\\d{1,12}\\.\\d{2}$',
    description: 'Monto en quetzales con 2 decimales, como string',
    examples: ['150.00'],
})

/**
 * RFC 9457. Los campos base (`type`, `title`, `status`, `detail`, `errors`) conservan esta forma (la
 * usa el frontend desde la semilla). Se permiten miembros de extensión **opcionales** (RFC 9457
 * §3.2), declarados aquí para tiparlos; un cliente que no los conoce los ignora.
 */
export const Problem = definirEsquema('Problem', {
    type: 'object',
    required: ['type', 'title', 'status'],
    properties: {
        type: { type: 'string' },
        title: { type: 'string' },
        status: { type: 'integer' },
        detail: { type: 'string' },
        reintentar_en: {
            type: 'string',
            format: 'date-time',
            description:
                'Extensión: cuándo se reintenta (UTC) si el servicio externo está en pausa por la ' +
                'espera exponencial (p. ej. `horus_error`). `detail` lo dice en hora de Guatemala',
        },
        errors: {
            type: 'array',
            items: {
                type: 'object',
                required: ['field', 'message'],
                properties: {
                    field: { type: 'string' },
                    message: { type: 'string' },
                    rule: { type: 'string' },
                },
            },
        },
    },
})
