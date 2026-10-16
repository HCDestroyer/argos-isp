import type { Schema } from '@argosisp/contracts'

type Banco = Schema<'Banco'>
type CuentaBancaria = Schema<'CuentaBancaria'>

/**
 * Catálogo de bancos con el mismo orden e ids que la migración de A3
 * (`billing.bancos`, `orden` ascendente; "Otro" al final).
 */
const NOMBRES_BANCOS = [
    'Banrural',
    'Banco Industrial',
    'Banco G&T Continental',
    'BAM',
    'BAC Credomatic',
    'Bantrab',
    'Banco Promerica',
    'Banco Inmobiliario',
    'Banco Internacional',
    'Banco Ficohsa',
    'Banco Azteca',
    'Vivibanco',
    'Crédito Hipotecario Nacional',
    'Banco de Antigua',
    'Banco INV',
    'Banco Cuscatlán',
    'Banco Nexa',
    'Otro',
] as const

export const bancos: Banco[] = NOMBRES_BANCOS.map((nombre, indice) => ({ id: indice + 1, nombre, activo: true }))

const CREADA = '2026-09-01T15:00:00.000Z'

function cuentaBancaria(id: number, bancoId: number, numero: string, alias: string, cuentaId: number, codigo: string, extra: Partial<CuentaBancaria> = {}): CuentaBancaria {
    return {
        id,
        banco_id: bancoId,
        banco_nombre: bancos.find(b => b.id === bancoId)?.nombre ?? '',
        numero,
        alias,
        moneda: 'GTQ',
        activa: true,
        cuenta_id: cuentaId,
        cuenta_codigo: codigo,
        version: 1,
        created_at: CREADA,
        updated_at: CREADA,
        ...extra,
    }
}

/**
 * Cuentas propias de destino (`GET /cuentas-bancarias`): dos en quetzales activas, una en
 * dólares (no recibe pagos) y una inactiva. `cuenta_id` es su subcuenta de 1.1.02 en el libro.
 */
export const cuentasBancarias: CuentaBancaria[] = [
    cuentaBancaria(1, 1, '3-033-04521-7', 'Recaudación', 6, '1.1.02.01'),
    cuentaBancaria(2, 2, '146-0012345-6', 'Monetaria', 16, '1.1.02.02'),
    cuentaBancaria(3, 2, '146-0098765-1', 'Dólares', 17, '1.1.02.03', { moneda: 'USD' }),
    cuentaBancaria(4, 3, '90-1234567-8', 'Cuenta anterior', 18, '1.1.02.04', { activa: false, version: 2 }),
]

/** "Banrural · Recaudación", como `cuenta_bancaria_nombre` de la vista `Pago`. */
export function nombreCuentaDestino(cuenta: CuentaBancaria): string {
    return `${cuenta.banco_nombre} · ${cuenta.alias}`
}
