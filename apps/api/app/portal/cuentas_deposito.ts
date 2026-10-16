/**
 * Cuentas bancarias para depósito que muestran `/corte` y el portal.
 *
 * La fuente única es `billing.cuentas_bancarias` de A3 (cada cuenta tiene su subcuenta en el
 * libro); el portal solo la lee, nunca escribe en `billing`. A3 exporta la consulta de solo lectura
 * en su rama (`listarCuentasBancarias({ activa: true })` de `#billing/cuentas_bancarias`); mientras
 * no esté en `main`, este puerto devuelve una lista vacía y `/corte` no muestra la sección (nunca
 * cuentas inventadas). Pedido en `.claude/integration/a5.md`. Las pruebas usan un falso.
 *
 * Solo salen banco, alias, número y moneda: nada del libro (cuenta contable, código).
 */

export interface CuentaDeposito {
    banco: string
    alias: string
    numero: string
    moneda: 'GTQ' | 'USD'
}

export interface FuenteCuentasDeposito {
    /** Cuentas activas, en el orden en que se muestran. */
    activas(): Promise<CuentaDeposito[]>
}

/** NEEDS(A3): reemplazar por un adaptador sobre la consulta de A3 cuando esté en `main`. */
export class CuentasDepositoPendientes implements FuenteCuentasDeposito {
    async activas(): Promise<CuentaDeposito[]> {
        return []
    }
}

let actual: FuenteCuentasDeposito | undefined

export function fuenteCuentasDeposito(): FuenteCuentasDeposito {
    actual ??= new CuentasDepositoPendientes()
    return actual
}

/** Reemplaza la fuente (pruebas). `undefined` vuelve a la de A3. */
export function usarFuenteCuentasDeposito(fuente: FuenteCuentasDeposito | undefined): void {
    actual = fuente
}
