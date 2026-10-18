import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { Conflicto, ValidacionFallida, type ErrorCampo } from '#shared/errores'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
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

/*
|--------------------------------------------------------------------------
| Retenciones recibidas en un pago (constancias del cliente, §3.5)
|--------------------------------------------------------------------------
*/

export interface PedidoConstancia {
    /** impuesto de retención recibida (`RET_IVA_ESP`, `RET_IVA_PUB`, `RET_IVA_TAR_COMB`, `RET_ISR_OPC`…) */
    codigo: string
    numero: string
    /** fecha de la constancia; por defecto hoy */
    fecha?: string | null
    monto: string
}

export interface ConstanciaRecibida {
    impuesto_codigo: string
    impuesto: 'iva' | 'isr'
    numero: string
    fecha: string
    monto: Dec
    cuenta: string
    cuadricula: string
}

/** Montos de las constancias pedidas (422 si alguno no es dinero positivo) y su total. */
export function leerRetencionesRecibidas(pedidos: PedidoConstancia[]): {
    pedidos: PedidoConstancia[]
    total: Dec
} {
    const errores: ErrorCampo[] = []
    let total = CERO
    pedidos.forEach((pedido, i) => {
        const monto = dec(pedido.monto)
        if (monto.lte(0) || monto.decimalPlaces() > 2) {
            errores.push({
                field: `retenciones.${i}.monto`,
                message: 'El monto de la constancia es mayor que 0 con hasta 2 decimales',
                rule: 'monto',
            })
        }
        if (!pedido.numero?.trim()) {
            errores.push({
                field: `retenciones.${i}.numero`,
                message: 'Falta el número de la constancia',
                rule: 'required',
            })
        }
        total = total.plus(monto)
    })
    if (errores.length > 0) throw new ValidacionFallida(errores, 'Constancias inválidas')
    return { pedidos, total }
}

/**
 * Valida las constancias de un pago de la empresa: impuesto de retención **recibida** (uso
 * `venta`, signo −1) con versión vigente en la fecha de la constancia; número no usado por otra
 * constancia del mismo impuesto en un pago vigente (409 `constancia_duplicada`).
 */
export async function validarRetencionesRecibidas(
    trx: QueryClientContract,
    empresaId: number,
    pedidos: PedidoConstancia[],
): Promise<ConstanciaRecibida[]> {
    const hoy = hoyGuatemala()
    const errores: ErrorCampo[] = []
    const salida: ConstanciaRecibida[] = []
    for (const [i, pedido] of pedidos.entries()) {
        const codigo = pedido.codigo.trim().toUpperCase()
        const fecha = pedido.fecha ? fechaValida(pedido.fecha, `retenciones.${i}.fecha`) : hoy
        if (fecha > hoy) {
            errores.push({
                field: `retenciones.${i}.fecha`,
                message: 'La constancia no puede ser futura',
                rule: 'futuro',
            })
            continue
        }
        let vigente: ImpuestoVigente
        try {
            vigente = await impuestoVigente(empresaId, codigo, fecha, trx)
        } catch {
            errores.push({
                field: `retenciones.${i}.codigo`,
                message: `El impuesto ${codigo} no existe o no tiene tasa vigente al ${fecha}`,
                rule: 'exists',
            })
            continue
        }
        const impuesto = impuestoDe(vigente.grupo)
        if (!impuesto || vigente.uso !== 'venta' || vigente.signo !== -1) {
            errores.push({
                field: `retenciones.${i}.codigo`,
                message: `${codigo} no es una retención recibida de un cliente (las emitidas llevan _C)`,
                rule: 'retencion',
            })
            continue
        }
        const numero = pedido.numero.trim().toUpperCase()
        if (salida.some((c) => c.impuesto === impuesto && c.numero === numero)) {
            errores.push({
                field: `retenciones.${i}.numero`,
                message: `Constancia ${numero} repetida`,
                rule: 'repetido',
            })
            continue
        }
        salida.push({
            impuesto_codigo: codigo,
            impuesto,
            numero,
            fecha,
            monto: dec(pedido.monto),
            cuenta: vigente.cuenta_cuota,
            cuadricula: vigente.cuadricula_cuota,
        })
    }
    if (errores.length > 0) throw new ValidacionFallida(errores, 'Constancias inválidas')
    for (const constancia of salida) {
        // dos pagos simultáneos con la misma constancia: el segundo espera y ve el primero
        await trx.rawQuery('SELECT pg_advisory_xact_lock(?, hashtext(?))', [
            3014,
            `${empresaId}:${constancia.impuesto}:${constancia.numero}`,
        ])
        const usada = await trx
            .from('ledger.constancias_retencion as k')
            .join('billing.pagos as p', 'p.id', 'k.pago_id')
            .where('k.empresa_id', empresaId)
            .where('k.direccion', 'recibida')
            .where('k.impuesto', constancia.impuesto)
            .where('k.numero', constancia.numero)
            .whereNot('p.estado', 'anulado')
            .select('k.pago_id')
            .first()
        if (usada) {
            throw new Conflicto(
                `La constancia de ${constancia.impuesto.toUpperCase()} ${constancia.numero} ya está en el pago ${usada.pago_id}`,
                'constancia_duplicada',
                'Constancia duplicada',
            )
        }
    }
    return salida
}

/** Filas de `ledger.constancias_retencion` (recibidas) del pago. */
export async function insertarConstanciasRecibidas(
    t: Transaccion,
    pagoId: number,
    empresaId: number,
    clienteId: number,
    constancias: ConstanciaRecibida[],
): Promise<void> {
    if (constancias.length === 0) return
    await t.trx
        .insertQuery()
        .table('ledger.constancias_retencion')
        .multiInsert(
            constancias.map((c) => ({
                empresa_id: empresaId,
                direccion: 'recibida',
                impuesto: c.impuesto,
                impuesto_codigo: c.impuesto_codigo,
                numero: c.numero,
                fecha: c.fecha,
                monto: aTexto(c.monto),
                pago_id: pagoId,
                cliente_id: clienteId,
                registrado_por: usuarioDelActor(t.ctx.actor),
            })),
        )
}
