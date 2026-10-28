import vine from '@vinejs/vine'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'

/**
 * Origen externo de un registro (pedidos A3 y A4 de Iris, `contratos/iris.md` §5.1): la orden de
 * trabajo de Iris que originó un consumo, un comodato, una devolución, una pérdida o un cargo único.
 *
 * - En el cuerpo viaja como `origen_tipo` + `origen_id` (los nombres del contrato con Iris). Se guarda
 *   en `origen_externo_tipo` + `origen_externo_id` (texto), aparte del `origen_tipo`/`origen_id`
 *   interno del kardex (compra, factura, conteo…; `bigint`), que no admite un UUID.
 * - Valores admitidos: solo `iris_orden`. Los orígenes internos no se aceptan del cliente: los pone el
 *   sistema. Con `origen_tipo`, `origen_id` es obligatorio, y al revés (422).
 * - Solo trazabilidad: no cambia costos, asientos ni saldos.
 */

export const ORIGENES_EXTERNOS = ['iris_orden'] as const
export type OrigenExternoTipo = (typeof ORIGENES_EXTERNOS)[number]

export interface OrigenExterno {
    tipo: OrigenExternoTipo
    id: string
}

/** Campos del cuerpo (se esparcen en el `vine.object` de cada ruta). */
export function reglasOrigenExterno() {
    return {
        origen_tipo: vine.enum(ORIGENES_EXTERNOS).nullable().optional().meta({
            description:
                'Sistema que origina la operación: iris_orden = orden de trabajo de Iris. Con él, origen_id es obligatorio',
        }),
        origen_id: vine
            .string()
            .trim()
            .minLength(1)
            .maxLength(100)
            .regex(/^[A-Za-z0-9._:-]+$/)
            .nullable()
            .optional()
            .meta({
                description:
                    'Id del registro de origen (el UUID de la orden de Iris); obligatorio con origen_tipo',
                examples: ['0192f3a4-7c1e-7b2a-9d40-5e6f7a8b9c0d'],
            }),
    }
}

/** El origen del cuerpo, validado en pareja; null si no viene. */
export function origenExternoDe(input: {
    origen_tipo?: OrigenExternoTipo | null
    origen_id?: string | null
}): OrigenExterno | null {
    const tipo = input.origen_tipo ?? null
    const id = input.origen_id?.trim() || null
    const errores: ErrorCampo[] = []
    if (tipo && !id) {
        errores.push({
            field: 'origen_id',
            message: 'Con origen_tipo, origen_id es obligatorio',
            rule: 'required',
        })
    }
    if (id && !tipo) {
        errores.push({
            field: 'origen_tipo',
            message: 'Con origen_id, origen_tipo es obligatorio',
            rule: 'required',
        })
    }
    if (tipo && !(ORIGENES_EXTERNOS as readonly string[]).includes(tipo)) {
        errores.push({ field: 'origen_tipo', message: `Origen no admitido: ${tipo}`, rule: 'enum' })
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
    return tipo && id ? { tipo, id } : null
}

/** Columnas para insertar. */
export function columnasOrigenExterno(origen: OrigenExterno | null | undefined) {
    return { origen_externo_tipo: origen?.tipo ?? null, origen_externo_id: origen?.id ?? null }
}
