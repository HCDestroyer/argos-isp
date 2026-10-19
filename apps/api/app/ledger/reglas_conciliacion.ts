import type { Transaccion } from '#shared/domain_action'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { aTexto, dec, tieneCentavosExactos } from '#ledger/dinero'
import { esCuentaDeBanco } from '#ledger/cuentas_banco'
import { contrapartidaProhibida } from '#ledger/conciliacion'

/**
 * Reglas de conciliación (contrato de localización fiscal §10.3): configuración por empresa con
 * `version` y `audit.cambios`.
 *
 * - Condición: el texto de la línea (descripción + referencia) **contiene** el patrón (sin
 *   distinguir mayúsculas) o cumple la **regex**; opcionalmente un rango de monto (con signo) y una
 *   cuenta bancaria.
 * - Acción: `contrapartida` (registra la línea con un asiento nuevo contra esa cuenta y la
 *   concilia) o `cliente` (busca el pago bancario del cliente con esa referencia y ese monto en la
 *   cuenta, y lo concilia).
 *
 * Validación común de `bancos.crear_regla` y `bancos.editar_regla` (permiso `bancos.conciliar`).
 */

export interface EntradaRegla {
    empresa_id?: number | null
    nombre: string
    cuenta_id?: number | null
    tipo_condicion: 'contiene' | 'regex'
    patron: string
    monto_min?: string | null
    monto_max?: string | null
    accion: 'contrapartida' | 'cliente'
    contrapartida?: string | null
    prioridad?: number
    activa?: boolean
}

export async function normalizarRegla(t: Transaccion, input: EntradaRegla, empresaId: number) {
    const errores: ErrorCampo[] = []
    const nombre = input.nombre?.trim() ?? ''
    if (nombre.length < 2) {
        errores.push({ field: 'nombre', message: 'El nombre es obligatorio', rule: 'required' })
    }
    const patron = input.patron?.trim() ?? ''
    if (!patron) errores.push({ field: 'patron', message: 'El patrón es obligatorio', rule: 'required' })
    if (input.tipo_condicion === 'regex') {
        try {
            new RegExp(patron, 'i')
        } catch {
            errores.push({ field: 'patron', message: 'La expresión regular no es válida', rule: 'regex' })
        }
    }
    const monto = (valor: string | null | undefined, campo: string) => {
        if (valor === null || valor === undefined || valor === '') return null
        if (!tieneCentavosExactos(valor)) {
            errores.push({ field: campo, message: 'Hasta 2 decimales', rule: 'monto' })
        }
        return aTexto(valor)
    }
    const montoMin = monto(input.monto_min, 'monto_min')
    const montoMax = monto(input.monto_max, 'monto_max')
    if (montoMin !== null && montoMax !== null && dec(montoMin).gt(montoMax)) {
        errores.push({ field: 'monto_max', message: 'monto_max es menor que monto_min', rule: 'rango' })
    }
    if (input.cuenta_id) {
        const cuenta = await t.trx
            .from('ledger.cuentas')
            .where('id', input.cuenta_id)
            .select('codigo', 'empresa_id')
            .first()
        if (
            !cuenta ||
            !esCuentaDeBanco(cuenta.codigo) ||
            (cuenta.empresa_id !== null && Number(cuenta.empresa_id) !== empresaId)
        ) {
            errores.push({
                field: 'cuenta_id',
                message: 'No es una cuenta bancaria de la empresa',
                rule: 'cuenta_banco',
            })
        }
    }
    let contrapartidaId: number | null = null
    if (input.accion === 'contrapartida') {
        const codigo = input.contrapartida?.trim() ?? ''
        const cuenta = codigo
            ? await t.trx
                  .from('ledger.cuentas')
                  .where('codigo', codigo)
                  .where('pais', 'GT')
                  .select('id', 'codigo', 'imputable', 'activa', 'auxiliar_cliente', 'auxiliar_proveedor')
                  .first()
            : null
        if (
            !cuenta ||
            !cuenta.imputable ||
            !cuenta.activa ||
            cuenta.auxiliar_cliente ||
            cuenta.auxiliar_proveedor ||
            contrapartidaProhibida(cuenta.codigo)
        ) {
            errores.push({ field: 'contrapartida', message: 'Contrapartida inválida', rule: 'contrapartida' })
        } else {
            contrapartidaId = Number(cuenta.id)
        }
    } else if (input.contrapartida) {
        errores.push({
            field: 'contrapartida',
            message: 'Solo aplica a la acción contrapartida',
            rule: 'no_aplica',
        })
    }
    if (errores.length > 0) throw new ValidacionFallida(errores)
    return {
        nombre,
        cuenta_id: input.cuenta_id ?? null,
        tipo_condicion: input.tipo_condicion,
        patron,
        monto_min: montoMin,
        monto_max: montoMax,
        accion: input.accion,
        contrapartida_cuenta_id: contrapartidaId,
        prioridad: input.prioridad ?? 100,
        activa: input.activa ?? true,
    }
}
