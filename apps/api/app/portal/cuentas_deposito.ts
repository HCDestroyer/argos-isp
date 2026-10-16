import { listarCuentasBancarias } from '#billing/cuentas_bancarias'

/**
 * Cuentas bancarias para depósito que muestran `/corte` y el portal.
 *
 * La fuente única es `billing.cuentas_bancarias` de A3 (cada cuenta tiene su subcuenta en el
 * libro); el portal solo la lee con `listarCuentasBancarias({ activa: true })` de
 * `#billing/cuentas_bancarias` y nunca escribe en `billing`. Sin cuentas activas devuelve `[]` y
 * `/corte` no muestra la sección (nunca cuentas inventadas). Las pruebas pueden usar un falso.
 *
 * **Las cuentas en dólares no se muestran.** Los avisos de cobro y los pagos del portal son en
 * quetzales; un depósito en una cuenta en USD lo convierte el banco a su tipo de cambio y el monto
 * acreditado ya no coincide con la deuda. Se ocultan en vez de marcarlas: en la página de corte (en
 * el teléfono, con prisa) una cuenta con advertencia sigue invitando a depositar ahí.
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

/** Adaptador sobre la consulta de solo lectura de A3: activas y en quetzales, en el orden de A3. */
export class CuentasDepositoBilling implements FuenteCuentasDeposito {
    async activas(): Promise<CuentaDeposito[]> {
        const cuentas = await listarCuentasBancarias({ activa: true })
        return cuentas
            .filter((cuenta) => cuenta.moneda === 'GTQ')
            .map((cuenta) => ({
                banco: cuenta.banco_nombre,
                alias: cuenta.alias,
                numero: cuenta.numero,
                moneda: cuenta.moneda,
            }))
    }
}

let actual: FuenteCuentasDeposito | undefined

export function fuenteCuentasDeposito(): FuenteCuentasDeposito {
    actual ??= new CuentasDepositoBilling()
    return actual
}

/** Reemplaza la fuente (pruebas). `undefined` vuelve a la de A3. */
export function usarFuenteCuentasDeposito(fuente: FuenteCuentasDeposito | undefined): void {
    actual = fuente
}
