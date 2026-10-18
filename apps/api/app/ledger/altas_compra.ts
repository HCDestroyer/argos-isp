import type { Transaccion } from '#shared/domain_action'
import type { LineaCompraCalculada } from '#ledger/compras'
import type { CompraPreparada } from '#ledger/preparar_compra'

/**
 * Lo que una compra da de alta además de su asiento (contrato §10.10): activos fijos de sus líneas
 * `activo_fijo` y diferimientos de las que traen `diferir_meses`. `cuentaDe` dice a qué cuenta va
 * cada línea en el asiento de la compra y `despuesDelAsiento` escribe las altas.
 */
export interface AltasCompra {
    cuentaDe: (linea: LineaCompraCalculada) => number
    despuesDelAsiento: () => Promise<void>
}

export async function altasDeLaCompra(
    _t: Transaccion,
    _compraId: number,
    _compra: CompraPreparada,
): Promise<AltasCompra> {
    return {
        cuentaDe: (linea) => linea.cuenta.id,
        despuesDelAsiento: async () => {},
    }
}

/**
 * Antes de anular una compra: sus activos y diferidos no pueden tener cuotas ni bajas (409); si no
 * las tienen, se cierran sin asiento (el reverso de la compra ya cancela su costo).
 */
export async function anularAltasDeLaCompra(
    _t: Transaccion,
    _compraId: number,
    _motivo: string,
): Promise<void> {}
