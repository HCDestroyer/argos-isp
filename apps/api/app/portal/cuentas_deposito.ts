import { listarCuentasDeposito } from '#billing/cuentas_bancarias'
import { EMPRESA_PRINCIPAL, unicaEmpresaActiva } from '#core/empresas'

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
 * dineros entre NIT), así que se piden por empresa y una empresa nunca muestra las de otra.
 * Mientras A3 no agregue `empresa_id` a las cuentas (pedido en `a5.md`), todas se consideran de la
 * empresa principal (la migración de A3 las dejará ahí): se muestran para la principal o cuando
 * hay una sola empresa activa; para otra empresa la lista sale vacía y `/corte` ofrece el contacto
 * de esa empresa. **Punto de cambio:** en cuanto `listarCuentasDeposito` devuelva `empresa_id` (o
 * acepte el filtro), se filtra por ella y la regla provisional deja de aplicarse sola.
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
        const cuentas = (await listarCuentasDeposito()) as Array<
            Awaited<ReturnType<typeof listarCuentasDeposito>>[number] & {
                empresa_id?: number | string | null
            }
        >
        const porEmpresa = cuentas.some((cuenta) => cuenta.empresa_id !== undefined)
        if (!porEmpresa && !(await deLaEmpresaPrincipal(empresaId))) return []
        return cuentas
            .filter((cuenta) => !porEmpresa || Number(cuenta.empresa_id) === empresaId)
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

/** Regla provisional: cuentas sin empresa = de la principal (o de la única empresa activa). */
async function deLaEmpresaPrincipal(empresaId: number): Promise<boolean> {
    if (empresaId === EMPRESA_PRINCIPAL) return true
    return (await unicaEmpresaActiva()) === empresaId
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
