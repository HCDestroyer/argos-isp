import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { Conflicto, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import type { MetodoPago } from '#shared/eventos'

/**
 * Datos bancarios de un cobro (`POST /pagos` y comprobantes de depósito): qué exige cada método,
 * validación por campo (422) y unicidad de la referencia.
 */

export type CampoBancario = 'referencia' | 'cuenta_bancaria_id' | 'banco_origen_id'

/** Datos obligatorios por método (además de monto y cliente). */
export const DATOS_POR_METODO: Partial<Record<MetodoPago, CampoBancario[]>> = {
    deposito: ['cuenta_bancaria_id', 'referencia'],
    transferencia: ['banco_origen_id', 'cuenta_bancaria_id', 'referencia'],
    ach: ['banco_origen_id', 'cuenta_bancaria_id', 'referencia'],
    remesa: ['cuenta_bancaria_id', 'referencia'],
}

export interface EntradaDatosBancarios {
    metodo: MetodoPago
    /** ya recortada; null si no vino */
    referencia: string | null
    cuenta_bancaria_id?: number | null
    banco_origen_id?: number | null
}

export interface DatosBancarios {
    cuentaBancariaId: number | null
    bancoOrigenId: number | null
    /** subcuenta del libro de la cuenta bancaria de destino */
    cuentaLibro: number | null
}

/**
 * Valida los datos bancarios según el método (422 con un error por campo: `required` si falta,
 * `no_aplica` si sobra, `exists` o `moneda` si la cuenta o el banco no sirven) y resuelve la
 * subcuenta del libro de la cuenta bancaria de destino.
 */
export async function validarDatosBancarios(
    cliente: QueryClientContract,
    entrada: EntradaDatosBancarios,
): Promise<DatosBancarios> {
    const requeridos = DATOS_POR_METODO[entrada.metodo] ?? []
    const valores = {
        referencia: entrada.referencia,
        cuenta_bancaria_id: entrada.cuenta_bancaria_id ?? null,
        banco_origen_id: entrada.banco_origen_id ?? null,
    }
    const errores: ErrorCampo[] = []
    for (const campo of requeridos) {
        if (valores[campo] === null) {
            errores.push({
                field: campo,
                message: `Obligatorio con método ${entrada.metodo}`,
                rule: 'required',
            })
        }
    }
    for (const campo of ['cuenta_bancaria_id', 'banco_origen_id'] as const) {
        if (valores[campo] !== null && !requeridos.includes(campo)) {
            errores.push({
                field: campo,
                message: `No aplica con método ${entrada.metodo}`,
                rule: 'no_aplica',
            })
        }
    }
    let cuentaLibro: number | null = null
    if (valores.cuenta_bancaria_id !== null && requeridos.includes('cuenta_bancaria_id')) {
        const cuenta = await cliente
            .from('billing.cuentas_bancarias')
            .where('id', valores.cuenta_bancaria_id)
            .select('cuenta_id', 'activa', 'moneda')
            .first()
        if (!cuenta || !cuenta.activa) {
            errores.push({
                field: 'cuenta_bancaria_id',
                message: `La cuenta bancaria ${valores.cuenta_bancaria_id} no existe o está inactiva`,
                rule: 'exists',
            })
        } else if (cuenta.moneda !== 'GTQ') {
            errores.push({
                field: 'cuenta_bancaria_id',
                message: `La cuenta bancaria ${valores.cuenta_bancaria_id} es en ${cuenta.moneda}; los pagos se registran en quetzales`,
                rule: 'moneda',
            })
        } else {
            cuentaLibro = cuenta.cuenta_id as number
        }
    }
    if (valores.banco_origen_id !== null && requeridos.includes('banco_origen_id')) {
        const banco = await cliente
            .from('billing.bancos')
            .where('id', valores.banco_origen_id)
            .select('id')
            .first()
        if (!banco) {
            errores.push({
                field: 'banco_origen_id',
                message: `El banco ${valores.banco_origen_id} no existe`,
                rule: 'exists',
            })
        }
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
    return {
        cuentaBancariaId: requeridos.includes('cuenta_bancaria_id') ? valores.cuenta_bancaria_id : null,
        bancoOrigenId: requeridos.includes('banco_origen_id') ? valores.banco_origen_id : null,
        cuentaLibro,
    }
}

/**
 * 409 `referencia_duplicada` si la referencia ya está en un pago (cualquier estado) del mismo
 * método y cuenta bancaria. Es la misma clave que el índice único `billing.pagos_metodo_referencia`.
 */
export async function exigirReferenciaLibre(
    cliente: QueryClientContract,
    metodo: MetodoPago,
    referencia: string | null,
    cuentaBancariaId: number | null,
): Promise<void> {
    if (!referencia) return
    const repetido = await cliente
        .from('billing.pagos')
        .where('metodo', metodo)
        .where('referencia', referencia)
        .if(
            cuentaBancariaId,
            (q) => q.where('cuenta_bancaria_id', cuentaBancariaId!),
            (q) => q.whereNull('cuenta_bancaria_id'),
        )
        .select('id')
        .first()
    if (repetido) {
        throw new Conflicto(
            `La referencia ${referencia} ya está registrada en el pago ${repetido.id} (${metodo}` +
                (cuentaBancariaId ? `, cuenta bancaria ${cuentaBancariaId})` : ')'),
            'referencia_duplicada',
            'Referencia duplicada',
        )
    }
}
