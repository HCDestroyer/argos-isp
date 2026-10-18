import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { CERO, aTexto, dec, redondear, type Dec } from '#ledger/dinero'
import { impuesto as impuestoVigente, type ImpuestoVigente } from '#fiscal/impuestos'
import { valorParametro } from '#fiscal/parametros'
import type { RetencionCalculada, TipoDocumentoCompra } from '#ledger/compras'
import type { ProveedorVista } from '#ledger/proveedores'

/**
 * Retenciones de IVA e ISR (contrato de localización fiscal §3.4, §3.5 y §6.2; impuestos de
 * `fiscal.impuestos`, §10.2): las que la empresa **emite** a sus proveedores (uso `compra`, a
 * `2.1.04` y `2.1.05`) y las que **recibe** de sus clientes con su constancia (uso `venta`, a
 * `1.1.05` y `1.1.06`, en el asiento del pago).
 *
 * Cálculo según el impuesto (`calculo`): `porcentaje_del_impuesto` (del IVA del documento),
 * `porcentaje_del_total` (del total) o `porcentaje_de_base` (del total sin IVA); la tasa vigente
 * en la fecha del documento. Un monto dado (el de la constancia) no puede pasar de la base.
 */

export interface PedidoRetencion {
    codigo: string
    /** monto de la constancia; sin él se calcula con la tasa vigente */
    monto?: string | null
}

export interface BaseRetencion {
    /** total del documento (con IVA) */
    total: Dec
    /** IVA del documento */
    iva: Dec
}

function impuestoDe(grupo: string): 'iva' | 'isr' | null {
    if (grupo === 'retencion_iva') return 'iva'
    if (grupo === 'retencion_isr') return 'isr'
    return null
}

/** Base del impuesto sobre el documento según su forma de cálculo. */
export function baseDeRetencion(calculo: string, documento: BaseRetencion): Dec {
    if (calculo === 'porcentaje_del_impuesto') return documento.iva
    if (calculo === 'porcentaje_del_total') return documento.total
    return documento.total.minus(documento.iva)
}

/**
 * Valida y calcula las retenciones pedidas para un documento de la empresa en `fecha`. `uso`:
 * `compra` (emitidas) o `venta` (recibidas). 422 por campo (`campo.N.codigo` / `.monto`).
 */
export async function calcularRetenciones(
    trx: QueryClientContract,
    empresaId: number,
    fecha: string,
    uso: 'compra' | 'venta',
    pedidos: PedidoRetencion[],
    documento: BaseRetencion,
    campo = 'retenciones',
): Promise<RetencionCalculada[]> {
    const errores: ErrorCampo[] = []
    const salida: RetencionCalculada[] = []
    const vistos = new Set<string>()
    for (const [i, pedido] of pedidos.entries()) {
        const codigo = pedido.codigo.trim().toUpperCase()
        if (vistos.has(codigo)) {
            errores.push({ field: `${campo}.${i}.codigo`, message: `${codigo} repetido`, rule: 'repetido' })
            continue
        }
        vistos.add(codigo)
        let vigente: ImpuestoVigente
        try {
            vigente = await impuestoVigente(empresaId, codigo, fecha, trx)
        } catch {
            errores.push({
                field: `${campo}.${i}.codigo`,
                message: `El impuesto ${codigo} no existe o no tiene tasa vigente al ${fecha}`,
                rule: 'exists',
            })
            continue
        }
        const impuesto = impuestoDe(vigente.grupo)
        if (!impuesto || vigente.uso !== uso || vigente.signo !== -1) {
            errores.push({
                field: `${campo}.${i}.codigo`,
                message:
                    uso === 'compra'
                        ? `${codigo} no es una retención emitida (las de compra llevan el sufijo _C)`
                        : `${codigo} no es una retención recibida de un cliente`,
                rule: 'retencion',
            })
            continue
        }
        const base = baseDeRetencion(vigente.calculo, documento)
        const calculado = redondear(base.times(vigente.tasa).div(100))
        const monto = pedido.monto !== undefined && pedido.monto !== null ? dec(pedido.monto) : calculado
        if (monto.lte(0) || monto.decimalPlaces() > 2 || monto.gt(base)) {
            errores.push({
                field: `${campo}.${i}.monto`,
                message: `La retención ${codigo} debe ser mayor que 0 y no pasar de su base (Q${aTexto(base)})`,
                rule: 'monto',
            })
            continue
        }
        salida.push({
            impuesto_codigo: codigo,
            impuesto,
            base,
            tasa: vigente.tasa,
            monto,
            cuenta: vigente.cuenta_cuota,
            cuadricula: vigente.cuadricula_cuota,
        })
    }
    if (errores.length > 0) throw new ValidacionFallida(errores, 'Retenciones inválidas')
    return salida
}

const DOCUMENTOS_CON_RETENCION: ReadonlySet<TipoDocumentoCompra> = new Set([
    'FACT',
    'FCAM',
    'NDEB',
    'FPEQ',
    'FCAP',
])

/**
 * Retenciones que la empresa debe emitir en una compra cuando la petición no las indica
 * (`retenciones` ausente; `[]` = ninguna). **Confirmar con contador** (§15):
 *
 * - IVA, si la empresa es agente (`agente_retencion_iva`) y el proveedor no lo es: 15 % del IVA
 *   (`RET_IVA_ESP_C`) a un proveedor general desde `ret_iva_minimo`; 5 % del total
 *   (`RET_IVA_PEQ_C`) a un pequeño contribuyente desde `ret_iva_pequeno_desde`.
 * - ISR: 7 % de lo pagado sin IVA (`RET_ISR_OPC_C`) a un proveedor del régimen opcional
 *   simplificado, si la empresa lleva contabilidad completa (régimen distinto de pequeño
 *   contribuyente).
 * - No residentes, facturas especiales, dividendos y premios: la categoría la decide quien registra.
 */
export async function sugerirRetencionesCompra(
    trx: QueryClientContract,
    empresaId: number,
    fecha: string,
    proveedor: Pick<ProveedorVista, 'tipo' | 'regimen_isr' | 'agente_retencion_iva'>,
    tipoDocumento: TipoDocumentoCompra,
    documento: BaseRetencion,
): Promise<PedidoRetencion[]> {
    if (!DOCUMENTOS_CON_RETENCION.has(tipoDocumento)) return []
    const pedidos: PedidoRetencion[] = []
    const agente = await valorParametro<boolean>(empresaId, 'agente_retencion_iva', fecha, trx).catch(
        () => false,
    )
    if (agente && !proveedor.agente_retencion_iva) {
        if (proveedor.tipo === 'general' && documento.iva.gt(0)) {
            const minimo = await valorParametro<string>(empresaId, 'ret_iva_minimo', fecha, trx)
            if (documento.total.gte(dec(minimo))) pedidos.push({ codigo: 'RET_IVA_ESP_C' })
        }
        if (proveedor.tipo === 'pequeno_contribuyente') {
            const desde = await valorParametro<string>(empresaId, 'ret_iva_pequeno_desde', fecha, trx)
            if (documento.total.gte(dec(desde))) pedidos.push({ codigo: 'RET_IVA_PEQ_C' })
        }
    }
    if (proveedor.tipo === 'general' && proveedor.regimen_isr === 'opcional_simplificado') {
        const regimen = await valorParametro<string>(empresaId, 'regimen', fecha, trx).catch(
            () => 'utilidades',
        )
        if (regimen !== 'pequeno_contribuyente') pedidos.push({ codigo: 'RET_ISR_OPC_C' })
    }
    return pedidos
}

/** Suma de las retenciones de un impuesto. */
export function totalRetenido(retenciones: RetencionCalculada[], impuesto?: 'iva' | 'isr'): Dec {
    return retenciones
        .filter((r) => impuesto === undefined || r.impuesto === impuesto)
        .reduce((suma, r) => suma.plus(r.monto), CERO)
}
