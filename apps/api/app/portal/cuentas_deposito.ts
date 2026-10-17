import { listarCuentasDeposito } from '#billing/cuentas_bancarias'
import db from '@adonisjs/lucid/services/db'

/**
 * Cuentas bancarias para depósito que muestran `/corte` y el portal.
 *
 * La fuente única es `billing.cuentas_bancarias` de A3 (cada cuenta tiene su subcuenta en el
 * libro); el portal solo la lee con `listarCuentasDeposito()` de `#billing/cuentas_bancarias`
 * (activas y en quetzales, en el orden del panel) y nunca escribe en `billing`. Sin cuentas
 * activas devuelve `[]` y `/corte` no muestra la sección (nunca cuentas inventadas). Las pruebas
 * pueden usar un falso.
 *
 * **Las cuentas en dólares no se muestran.** Los avisos de cobro y los pagos del portal son en
 * quetzales; un depósito en una cuenta en USD lo convierte el banco a su tipo de cambio y el monto
 * acreditado ya no coincide con la deuda. Se ocultan en vez de marcarlas: en la página de corte (en
 * el teléfono, con prisa) una cuenta con advertencia sigue invitando a depositar ahí.
 *
 * Solo salen id, banco, alias, número y moneda: nada del libro (cuenta contable, código). El `id`
 * es el `cuenta_bancaria_id` que pide el comprobante de depósito.
 *
 * **Multiempresa:** las cuentas son de una empresa (`contratos/multiempresa.md`: no se cruzan
 * dineros entre NIT), así que se piden por empresa con `listarCuentasDeposito(trx, empresaId)` y
 * una empresa nunca muestra las de otra. Una empresa sin cuentas devuelve `[]` y `/corte` ofrece
 * el contacto de esa empresa. Un comprobante a la cuenta de otra empresa lo rechaza A3 con 422
 * `cuenta_de_otra_empresa`.
 */

export interface CuentaDeposito {
    /** `cuenta_bancaria_id` del comprobante (`POST /portal/comprobantes`) */
    id: number
    banco: string
    alias: string
    numero: string
    moneda: 'GTQ' | 'USD'
}

export interface FuenteCuentasDeposito {
    /** Cuentas activas de la empresa, en el orden en que se muestran. */
    activas(empresaId: number): Promise<CuentaDeposito[]>
}

/** Adaptador sobre la consulta de solo lectura de A3: activas y en quetzales, en el orden de A3. */
export class CuentasDepositoBilling implements FuenteCuentasDeposito {
    async activas(empresaId: number): Promise<CuentaDeposito[]> {
        const cuentas = await listarCuentasDeposito(db.connection(), empresaId)
        return cuentas
            .filter((cuenta) => cuenta.moneda === 'GTQ')
            .map((cuenta) => ({
                id: Number(cuenta.id),
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
