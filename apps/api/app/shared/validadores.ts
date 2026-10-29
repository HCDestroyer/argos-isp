import vine from '@vinejs/vine'
// corrección de `.meta()` de VineJS 4.4.0 (ver el módulo)
import '#shared/vine_meta'

/**
 * Piezas de validación comunes (VineJS). Cada una declara su `meta` para que el OpenAPI
 * generado tenga el tipo correcto.
 */

/** Monto en quetzales como string con hasta 2 decimales: "150", "150.5", "150.50". */
export const dinero = () =>
    vine
        .string()
        .trim()
        .regex(/^\d{1,12}(\.\d{1,2})?$/)
        .meta({ description: 'Monto con hasta 2 decimales, como string', examples: ['150.00'] })

/**
 * Fecha calendario YYYY-MM-DD. Llega al handler como string (sin zona horaria): conviértela con
 * `DateTime.fromISO(valor, { zone: 'utc' })` para no depender del TZ del servidor.
 */
export const fechaIso = () =>
    vine
        .string()
        .trim()
        .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/)
        .meta({ format: 'date' })

/** Instante ISO 8601. Llega al handler como `Date`. */
export const instanteIso = () =>
    vine.date({ formats: ['iso8601'] }).meta({ type: 'string', format: 'date-time' })

/** Id de entidad (bigint identity). */
export const idEntidad = () => vine.number().withoutDecimals().min(1)

/** `version` leída por el cliente para control optimista (409 si no coincide). */
export const versionEsperada = () =>
    vine.number().withoutDecimals().min(1).meta({ description: 'version leída; si cambió responde 409' })

export const ipv4 = () => vine.string().trim().ipAddress(4)

const CIDR_V4 = /^(\d{1,3}\.){3}\d{1,3}\/([0-9]|[12][0-9]|3[0-2])$/
const CIDR_V6 = /^[0-9a-fA-F:]+\/([0-9]|[1-9][0-9]|1[01][0-9]|12[0-8])$/

export const cidrV4 = () =>
    vine.string().trim().regex(CIDR_V4).meta({ description: 'Red IPv4 en notación CIDR' })
export const prefijoV6 = () =>
    vine.string().trim().regex(CIDR_V6).meta({ description: 'Prefijo IPv6 en notación CIDR' })

/** Motivo obligatorio de acciones de estado (suspender, anular…). */
export const motivo = () => vine.string().trim().minLength(3).maxLength(500)

/** "lat,lng" */
export const coordenadas = () =>
    vine
        .string()
        .trim()
        .regex(/^-?\d+(\.\d+)?, ?-?\d+(\.\d+)?$/)
        .meta({ description: 'Latitud y longitud: "14.6349,-90.5069"' })

const LATITUD = String.raw`-?(?:90(?:\.0+)?|[1-8]?\d(?:\.\d{1,15})?)`
const LONGITUD = String.raw`-?(?:180(?:\.0+)?|(?:1[0-7]\d|[1-9]?\d)(?:\.\d{1,15})?)`

/**
 * "lat,lng" en grados decimales con rango válido (latitud −90…90, longitud −180…180). Mismo formato
 * que `coordenadas` de clientes y servicios; lo usan los routers (contrato Iris 0.3.1).
 */
export const coordenadasEnRango = () =>
    vine
        .string()
        .trim()
        .regex(new RegExp(`^${LATITUD}, ?${LONGITUD}$`))
        .meta({
            description:
                'Latitud y longitud en grados decimales: "14.634900,-90.506900" (latitud −90…90, longitud −180…180; se guardan con 6 decimales)',
        })

/** Empresa sugerida para los servicios nuevos (zona o router); `null` la quita. */
export const empresaSugerida = () =>
    vine.number().withoutDecimals().min(1).nullable().optional().meta({
        description:
            'Empresa por defecto de los servicios nuevos (servicio > zona > router > empresa activa)',
    })

/** `?empresas=todas`: modo consolidado de las listas (solo alcance global o acceso a todas). */
export const empresasConsulta = () =>
    vine
        .enum(['todas'] as const)
        .optional()
        .meta({
            description:
                'todas = consolidado de todas las empresas (solo con alcance global o acceso a todas); sin él, la empresa activa',
        })
