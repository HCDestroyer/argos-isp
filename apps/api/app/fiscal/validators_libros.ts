import vine from '@vinejs/vine'
import { reglasPaginacion } from '#shared/paginacion'
import { empresasConsulta, fechaIso, idEntidad } from '#shared/validadores'
import type { EsquemaJson } from '#shared/openapi/esquemas'
import { LIBROS_EMITIBLES, LIBROS_HABILITABLES } from '#fiscal/libros_legales'

/**
 * Validadores de los libros legales con folio (contrato de localización fiscal §7, fase 6 PR D).
 */

/** Vista previa: JSON, CSV, XLSX o PDF con la marca de agua «Borrador sin folio». */
export const formatoLibro = vine.enum(['json', 'csv', 'xlsx', 'pdf'] as const).optional()

export const vistaPreviaLibroValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().optional().meta({ description: 'Por defecto la empresa activa' }),
        desde: fechaIso().optional().meta({ description: 'Por defecto el primer día del mes en curso' }),
        hasta: fechaIso().optional().meta({ description: 'Por defecto el último día del mes de desde' }),
        formato: formatoLibro,
    }),
)

export const emitirLibroValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().optional().meta({ description: 'Por defecto la empresa activa' }),
        // mes inicial (cualquier día: se toma el mes completo)
        desde: fechaIso(),
        hasta: fechaIso().optional().meta({ description: 'Mes final; por defecto el de desde' }),
        formato: vine
            .enum(['pdf', 'xlsx'] as const)
            .optional()
            .meta({ description: 'Por defecto pdf. XLSX: las filas con el folio de su página' }),
    }),
)

export const habilitarLibroValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().optional().meta({ description: 'Por defecto la empresa activa' }),
        libro: vine.enum(LIBROS_HABILITABLES),
        autorizacion: vine
            .string()
            .trim()
            .minLength(3)
            .maxLength(120)
            .meta({ description: 'Número de la autorización (SAT-7121 y Registro Mercantil)' }),
        folio_desde: vine.number().withoutDecimals().min(1),
        folio_hasta: vine.number().withoutDecimals().min(1),
        // fecha de la autorización (no futura)
        fecha: fechaIso(),
        nota: vine.string().trim().maxLength(500).optional().nullable(),
    }),
)

export const listarLibrosValidator = vine.compile(
    vine.object({
        ...reglasPaginacion,
        libro: vine.enum(LIBROS_HABILITABLES).optional(),
        empresas: empresasConsulta(),
    }),
)

export const foliosLibrosValidator = vine.compile(
    vine.object({
        empresa_id: idEntidad().optional().meta({ description: 'Por defecto la empresa activa' }),
    }),
)

/** Parámetro `:libro` de `POST /libros/:libro/emitir` en el OpenAPI. */
export const libroEmitibleParametro: EsquemaJson = { type: 'string', enum: [...LIBROS_EMITIBLES] }
