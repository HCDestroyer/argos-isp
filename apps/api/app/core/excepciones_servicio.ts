import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import { Problema, ValidacionFallida } from '#shared/errores'
import { esCampoExcepcion, validarExcepcion, type CampoExcepcion } from '#billing/excepciones'

/**
 * Excepciones a la plantilla de facturación por servicio (`core.servicios_excepciones`, tarea 11).
 *
 * A1 guarda y expone; A3 define los campos y su validación (`app/billing/excepciones.ts`). Aquí no
 * se repite la lista de campos: todo pasa por `validarExcepcion`, que rechaza (422) los campos
 * que no son exceptuables.
 *
 * Entrada de la API: `excepciones: { campo: valor }`. `null` en un campo borra la excepción
 * (vuelve a regir la plantilla); un campo ausente no se toca.
 */

export type ExcepcionesServicio = Partial<Record<CampoExcepcion, unknown>>

/** Campos cuya excepción cambia lo que decide `evaluarEstadoServicio` (corte y promesas). */
export const CAMPOS_QUE_AFECTAN_CORTE: readonly CampoExcepcion[] = [
    'facturas_para_limitar',
    'facturas_para_cortar',
    'reglas_promesa',
]

/** Excepciones vigentes del servicio como `{ campo: valor }`. */
export async function leerExcepciones(
    trx: TransactionClientContract,
    servicioId: number,
): Promise<Record<string, unknown>> {
    const filas = (await trx
        .from('core.servicios_excepciones')
        .where('servicio_id', servicioId)
        .orderBy('campo')
        .select('campo', 'valor')) as Array<{ campo: string; valor: unknown }>
    return Object.fromEntries(filas.map((f) => [f.campo, f.valor]))
}

/**
 * Valida todas las excepciones con `validarExcepcion` (A3) y devuelve los valores normalizados.
 * Los errores se reportan como `excepciones.<campo>` para que el formulario los ubique.
 */
export async function validarExcepciones(
    excepciones: Record<string, unknown>,
): Promise<Record<string, unknown | null>> {
    const limpias: Record<string, unknown | null> = {}
    const errores: Array<{ field: string; message: string; rule?: string }> = []
    for (const [campo, valor] of Object.entries(excepciones)) {
        if (valor === undefined) continue
        if (valor === null && esCampoExcepcion(campo)) {
            // borrar la excepción: vuelve a regir la plantilla
            limpias[campo] = null
            continue
        }
        try {
            limpias[campo] = await validarExcepcion(campo, valor)
        } catch (error) {
            if (!(error instanceof Problema) || error.status !== 422) throw error
            errores.push(...erroresDe(error, campo))
        }
    }
    if (errores.length > 0) {
        throw new ValidacionFallida(errores, 'Hay excepciones a la plantilla que no son válidas')
    }
    return limpias
}

function erroresDe(error: Problema, campo: string) {
    return (error.errores ?? []).map((e) => ({
        field: `excepciones.${campo}`,
        message: e.message,
        ...(e.rule ? { rule: e.rule } : {}),
    }))
}

/**
 * Aplica `{ campo: valor | null }` (ya validado) sobre las filas del servicio. Devuelve los campos
 * que cambiaron de verdad (insertados, modificados o borrados).
 */
export async function guardarExcepciones(
    trx: TransactionClientContract,
    servicioId: number,
    excepciones: Record<string, unknown | null>,
): Promise<string[]> {
    const actuales = await leerExcepciones(trx, servicioId)
    const cambiados: string[] = []
    for (const [campo, valor] of Object.entries(excepciones)) {
        const previo = actuales[campo]
        if (valor === null) {
            if (previo === undefined) continue
            await trx.from('core.servicios_excepciones').where({ servicio_id: servicioId, campo }).delete()
            cambiados.push(campo)
            continue
        }
        if (previo !== undefined && JSON.stringify(previo) === JSON.stringify(valor)) continue
        await trx.rawQuery(
            `INSERT INTO core.servicios_excepciones (servicio_id, campo, valor)
             VALUES (?, ?, ?::jsonb)
             ON CONFLICT (servicio_id, campo) DO UPDATE
                SET valor = EXCLUDED.valor,
                    version = core.servicios_excepciones.version + 1,
                    updated_at = now()`,
            [servicioId, campo, JSON.stringify(valor)],
        )
        cambiados.push(campo)
    }
    return cambiados.sort()
}

/**
 * Vista del servicio aplanada para `audit.cambios`: cada excepción como su propio campo
 * (`excepcion_<campo>`), así el diff es por campo y no un objeto entero.
 */
export function paraAuditoriaServicio<T extends { excepciones?: Record<string, unknown> }>(
    vista: T,
): Record<string, unknown> {
    const { excepciones, ...resto } = vista
    const plano: Record<string, unknown> = { ...resto }
    for (const [campo, valor] of Object.entries(excepciones ?? {})) {
        plano[`excepcion_${campo}`] = valor
    }
    return plano
}
