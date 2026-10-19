import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { ReglaNegocio, ValidacionFallida } from '#shared/errores'
import { CUENTAS } from '#ledger/plan_cuentas'

/**
 * Cuenta bancaria **del libro** (una subcuenta de `1.1.02 Bancos`) para depósitos, traslados,
 * liquidaciones de cobros y extractos (contrato de localización fiscal §10.3).
 *
 * Se pide de tres formas, la que tenga el panel a mano: `cuenta_bancaria_id` (cuenta propia de
 * `billing.cuentas_bancarias`, activa y en quetzales), `banco_id` (banco del libro de
 * `ledger.bancos`, como en los egresos) o `cuenta_id` (la subcuenta directa). El resultado es
 * siempre la cuenta del libro y la empresa dueña (null en una cuenta común como `1.1.02.01`).
 */

export interface PedidoCuentaBanco {
    cuenta_id?: number | null
    cuenta_bancaria_id?: number | null
    banco_id?: number | null
}

export interface CuentaBanco {
    cuenta_id: number
    codigo: string
    nombre: string
    /** empresa dueña de la subcuenta; null = cuenta común (su saldo es por libro de empresa) */
    empresa_id: number | null
    cuenta_bancaria_id: number | null
    banco_id: number | null
}

/** true si el código es una subcuenta de `1.1.02 Bancos`. */
export function esCuentaDeBanco(codigo: string): boolean {
    return codigo.startsWith(`${CUENTAS.BANCOS}.`)
}

/**
 * Resuelve la cuenta del libro. `prefijo` es el nombre del campo en los errores (`origen_`,
 * `destino_` o vacío). Con `empresaId`, la cuenta debe ser de esa empresa o común (422
 * `cuenta_de_otra_empresa`: un depósito o un traslado nunca cruza NIT).
 */
export async function resolverCuentaBanco(
    trx: QueryClientContract,
    pedido: PedidoCuentaBanco,
    opciones: { prefijo?: string; empresaId?: number | null; obligatoria?: boolean } = {},
): Promise<CuentaBanco | null> {
    const prefijo = opciones.prefijo ?? ''
    const dados = (['cuenta_id', 'cuenta_bancaria_id', 'banco_id'] as const).filter(
        (campo) => pedido[campo] !== undefined && pedido[campo] !== null,
    )
    if (dados.length === 0) {
        if (opciones.obligatoria === false) return null
        throw new ValidacionFallida([
            {
                field: `${prefijo}cuenta_bancaria_id`,
                message: 'Indica la cuenta bancaria (cuenta_bancaria_id, banco_id o cuenta_id)',
                rule: 'required',
            },
        ])
    }
    if (dados.length > 1) {
        throw new ValidacionFallida(
            dados.slice(1).map((campo) => ({
                field: `${prefijo}${campo}`,
                message: `Indica solo uno de ${dados.map((d) => prefijo + d).join(', ')}`,
                rule: 'no_aplica',
            })),
        )
    }
    let cuentaId: number
    let cuentaBancariaId: number | null = null
    let bancoId: number | null = null
    let empresaDocumento: number | null = null
    if (pedido.cuenta_bancaria_id) {
        const fila = (await trx
            .from('billing.cuentas_bancarias')
            .where('id', pedido.cuenta_bancaria_id)
            .select('id', 'empresa_id', 'cuenta_id', 'activa', 'moneda')
            .first()) as {
            id: number
            empresa_id: number
            cuenta_id: number
            activa: boolean
            moneda: string
        } | null
        if (!fila) {
            throw new ValidacionFallida([
                {
                    field: `${prefijo}cuenta_bancaria_id`,
                    message: `La cuenta bancaria ${pedido.cuenta_bancaria_id} no existe`,
                    rule: 'exists',
                },
            ])
        }
        if (!fila.activa || fila.moneda !== 'GTQ') {
            throw new ReglaNegocio(
                `La cuenta bancaria ${fila.id} está inactiva o no es en quetzales`,
                'cuenta_bancaria_no_disponible',
            )
        }
        cuentaId = Number(fila.cuenta_id)
        cuentaBancariaId = Number(fila.id)
        empresaDocumento = Number(fila.empresa_id)
    } else if (pedido.banco_id) {
        const fila = (await trx
            .from('ledger.bancos')
            .where('id', pedido.banco_id)
            .select('id', 'empresa_id', 'cuenta_id')
            .first()) as { id: number; empresa_id: number; cuenta_id: number } | null
        if (!fila) {
            throw new ValidacionFallida([
                {
                    field: `${prefijo}banco_id`,
                    message: `El banco ${pedido.banco_id} no existe en el libro`,
                    rule: 'exists',
                },
            ])
        }
        cuentaId = Number(fila.cuenta_id)
        bancoId = Number(fila.id)
        empresaDocumento = Number(fila.empresa_id)
    } else {
        cuentaId = Number(pedido.cuenta_id)
    }
    const cuenta = (await trx
        .from('ledger.cuentas')
        .where('id', cuentaId)
        .select('id', 'codigo', 'nombre', 'empresa_id', 'activa', 'imputable')
        .first()) as {
        id: number
        codigo: string
        nombre: string
        empresa_id: number | null
        activa: boolean
        imputable: boolean
    } | null
    if (!cuenta || !esCuentaDeBanco(cuenta.codigo) || !cuenta.activa || !cuenta.imputable) {
        throw new ValidacionFallida([
            {
                field: `${prefijo}${dados[0]}`,
                message: `La cuenta ${cuentaId} no es una cuenta bancaria activa del libro (subcuenta de ${CUENTAS.BANCOS})`,
                rule: 'cuenta_banco',
            },
        ])
    }
    const empresaCuenta = cuenta.empresa_id === null ? empresaDocumento : Number(cuenta.empresa_id)
    if (
        opciones.empresaId !== undefined &&
        opciones.empresaId !== null &&
        empresaCuenta !== null &&
        empresaCuenta !== opciones.empresaId
    ) {
        throw new ValidacionFallida([
            {
                field: `${prefijo}${dados[0]}`,
                message: `La cuenta ${cuenta.codigo} es de la empresa ${empresaCuenta}, no de la ${opciones.empresaId}: no se cruzan dineros entre NIT`,
                rule: 'cuenta_de_otra_empresa',
            },
        ])
    }
    return {
        cuenta_id: Number(cuenta.id),
        codigo: cuenta.codigo,
        nombre: cuenta.nombre,
        empresa_id: empresaCuenta,
        cuenta_bancaria_id: cuentaBancariaId,
        banco_id: bancoId,
    }
}

/** Siguiente subcuenta libre de un grupo (`1.1.10` → `1.1.10.03`). Llamar con el lock de subcuentas. */
export async function siguienteSubcuenta(trx: QueryClientContract, codigoPadre: string) {
    const padre = (await trx
        .from('ledger.cuentas')
        .where('codigo', codigoPadre)
        .where('pais', 'GT')
        .select('id', 'tipo')
        .firstOrFail()) as { id: number; tipo: string }
    const hijas = (await trx.from('ledger.cuentas').where('padre_id', padre.id).select('codigo')) as Array<{
        codigo: string
    }>
    const siguiente =
        Math.max(0, ...hijas.map((h) => Number(h.codigo.split('.').at(-1))).filter(Number.isFinite)) + 1
    return {
        padreId: Number(padre.id),
        tipo: padre.tipo,
        codigo: `${codigoPadre}.${String(siguiente).padStart(2, '0')}`,
    }
}

/** Mismo lock que cajas y cuentas bancarias (`crear_caja`): numeración de subcuentas sin carreras. */
export const LOCK_SUBCUENTAS = 3005
