import vine from '@vinejs/vine'
import { fechaIso, idEntidad, motivo, versionEsperada } from '#shared/validadores'
import { ValidacionFallida } from '#shared/errores'
import type { MapeoExtracto } from '#importacion/extractos/formatos'

/** Validadores de los estados de cuenta del banco (A6). */

const montoConSigno = () =>
    vine
        .string()
        .trim()
        .regex(/^-?\d{1,12}(\.\d{1,2})?$/)
        .meta({ description: 'Monto con signo y hasta 2 decimales' })

const columna = () => vine.number().withoutDecimals().min(0).max(200)

const reglasMapeo = vine.object({
    hoja: vine.string().trim().maxLength(100).nullable().optional(),
    fila_encabezado: vine.number().withoutDecimals().min(1).nullable(),
    fila_datos: vine.number().withoutDecimals().min(1),
    columnas: vine.object({
        fecha: columna(),
        descripcion: columna(),
        referencia: columna().nullable().optional(),
        debito: columna().nullable().optional(),
        credito: columna().nullable().optional(),
        monto: columna().nullable().optional(),
        saldo: columna().nullable().optional(),
    }),
    formato_fecha: vine.enum(['dmy', 'mdy', 'ymd']),
    decimal: vine.enum(['punto', 'coma']),
    encabezados: vine.array(vine.string().maxLength(200)).maxLength(200).optional(),
})

const validadorMapeo = vine.compile(reglasMapeo)

/**
 * `mapeo` llega como texto JSON en el formulario multipart (o como objeto en JSON): se valida y se
 * completa (columnas opcionales en null, encabezados vacíos).
 */
export async function leerMapeo(valor: unknown): Promise<MapeoExtracto | null> {
    if (valor === null || valor === undefined || valor === '') return null
    let crudo: unknown = valor
    if (typeof valor === 'string') {
        try {
            crudo = JSON.parse(valor)
        } catch {
            throw new ValidacionFallida([
                { field: 'mapeo', message: 'El mapeo no es JSON válido', rule: 'json' },
            ])
        }
    }
    try {
        const m = await validadorMapeo.validate(crudo)
        return {
            hoja: m.hoja ?? null,
            fila_encabezado: m.fila_encabezado,
            fila_datos: m.fila_datos,
            columnas: {
                fecha: m.columnas.fecha,
                descripcion: m.columnas.descripcion,
                referencia: m.columnas.referencia ?? null,
                debito: m.columnas.debito ?? null,
                credito: m.columnas.credito ?? null,
                monto: m.columnas.monto ?? null,
                saldo: m.columnas.saldo ?? null,
            },
            formato_fecha: m.formato_fecha,
            decimal: m.decimal,
            encabezados: m.encabezados ?? [],
        }
    } catch (e) {
        const mensajes = (e as { messages?: Array<{ field: string; message: string; rule: string }> })
            .messages
        throw new ValidacionFallida(
            (mensajes ?? [{ field: '', message: 'Mapeo inválido', rule: 'mapeo' }]).map((m) => ({
                field: `mapeo.${m.field}`.replace(/\.$/, ''),
                message: m.message,
                rule: m.rule,
            })),
        )
    }
}

const camposArchivo = {
    cuenta_bancaria_id: idEntidad().meta({ description: 'Cuenta bancaria propia del estado de cuenta' }),
    hoja: vine.string().trim().maxLength(100).nullable().optional(),
    mapeo: vine
        .string()
        .trim()
        .maxLength(20_000)
        .nullable()
        .optional()
        .meta({ description: 'MapeoExtracto en JSON (el confirmado en la vista previa)' }),
    saldo_inicial: montoConSigno().nullable().optional(),
    saldo_final: montoConSigno().nullable().optional(),
    desde: fechaIso().nullable().optional(),
    hasta: fechaIso().nullable().optional(),
}

export const vistaPreviaExtractoValidator = vine.compile(vine.object(camposArchivo))

export const importarExtractoArchivoValidator = vine.compile(
    vine.object({
        ...camposArchivo,
        guardar_mapeo: vine
            .boolean()
            .nullable()
            .optional()
            .meta({ description: 'Guardar el mapeo para la cuenta (por defecto sí)' }),
        motivo_no_encadena: motivo().nullable().optional(),
    }),
)

export const guardarMapeoExtractoValidator = vine.compile(
    vine.object({
        formato: vine
            .string()
            .trim()
            .regex(/^[a-z0-9_]{1,40}$/)
            .nullable()
            .optional(),
        mapeo: reglasMapeo,
        version: versionEsperada().nullable().optional(),
    }),
)
