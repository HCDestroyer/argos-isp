import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { ValidacionFallida } from '#shared/errores'
import { aTexto, dec, type Dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { estadoSegunPago, pendienteDe, type EstadoFactura } from '#billing/facturas'

/**
 * Piezas compartidas por las acciones que mueven el saldo de un cliente (emitir facturas,
 * registrar y anular pagos, mora). Siempre se llaman dentro de la transacción de una acción.
 *
 * Concurrencia: toda acción que aplica dinero a las facturas de un cliente toma primero
 * `bloquearCliente` (advisory lock de la transacción), así dos cobros simultáneos del mismo
 * cliente se aplican uno detrás del otro y nunca sobre el mismo pendiente.
 */

/** Espacio de los advisory locks de cobros (primer entero de `pg_advisory_xact_lock(int, int)`). */
const LOCK_COBROS_CLIENTE = 3003

export async function bloquearCliente(trx: TransactionClientContract, clienteId: number): Promise<void> {
    await trx.rawQuery('SELECT pg_advisory_xact_lock(?, ?)', [LOCK_COBROS_CLIENTE, clienteId])
}

export interface FacturaPendiente {
    id: number
    servicio_id: number | null
    total: string
    pagado: string
    vencida_en: Date | null
}

/**
 * Facturas con saldo del cliente, bloqueadas, en el orden de aplicación: primero las
 * `preferidas` en el orden pedido, luego la más antigua (vencimiento, periodo, id).
 */
export async function facturasPendientes(
    trx: TransactionClientContract,
    clienteId: number,
    preferidas: number[] = [],
): Promise<FacturaPendiente[]> {
    const filas = (await trx
        .from('billing.facturas')
        .where('cliente_id', clienteId)
        .whereIn('estado', ['emitida', 'parcial', 'vencida'])
        .orderBy([
            { column: 'vence_en', order: 'asc' },
            { column: 'periodo', order: 'asc' },
            { column: 'id', order: 'asc' },
        ])
        .forUpdate()
        .select('id', 'servicio_id', 'total', 'pagado', 'vencida_en')) as FacturaPendiente[]

    if (preferidas.length === 0) return filas
    const porId = new Map(filas.map((f) => [f.id, f]))
    const faltantes = preferidas.filter((id) => !porId.has(id))
    if (faltantes.length > 0) {
        throw new ValidacionFallida(
            faltantes.map((id) => ({
                field: 'facturas',
                message: `La factura ${id} no es del cliente o no tiene saldo pendiente`,
                rule: 'factura_pendiente',
            })),
        )
    }
    const primero = [...new Set(preferidas)].map((id) => porId.get(id)!)
    return [...primero, ...filas.filter((f) => !preferidas.includes(f.id))]
}

export interface Aplicacion {
    factura_id: number
    servicio_id: number | null
    monto: string
    estado: EstadoFactura
}

/** Suma `monto` a lo pagado de la factura y recalcula su estado. */
export async function sumarAPagado(
    trx: TransactionClientContract,
    factura: FacturaPendiente,
    monto: Dec,
): Promise<EstadoFactura> {
    const pagado = dec(factura.pagado).plus(monto)
    const estado = estadoSegunPago({ total: factura.total, pagado, vencida_en: factura.vencida_en })
    await trx
        .from('billing.facturas')
        .where('id', factura.id)
        .update({
            pagado: aTexto(pagado),
            estado,
            version: trx.knexRawQuery('version + 1'),
            updated_at: trx.knexRawQuery('now()'),
        } as Record<string, unknown>)
    factura.pagado = aTexto(pagado)
    return estado
}

/**
 * Aplica `monto` de un pago a las facturas pendientes (en el orden de `facturas`): escribe
 * `pagos_aplicaciones` y actualiza `pagado`/`estado`. Devuelve lo aplicado y lo que sobra.
 * No escribe el asiento: lo hace quien llama, con la contrapartida que corresponda.
 */
export async function aplicarAFacturas(
    trx: TransactionClientContract,
    pagoId: number,
    monto: Dec,
    facturas: FacturaPendiente[],
): Promise<{ aplicaciones: Aplicacion[]; aplicado: Dec; restante: Dec }> {
    let restante = monto
    const aplicaciones: Aplicacion[] = []
    for (const factura of facturas) {
        if (restante.lte(0)) break
        const pendiente = pendienteDe(factura)
        if (pendiente.lte(0)) continue
        const aplicar = pendiente.lt(restante) ? pendiente : restante
        await trx
            .insertQuery()
            .table('billing.pagos_aplicaciones')
            .insert({ pago_id: pagoId, factura_id: factura.id, monto: aTexto(aplicar) })
        const estado = await sumarAPagado(trx, factura, aplicar)
        aplicaciones.push({
            factura_id: factura.id,
            servicio_id: factura.servicio_id,
            monto: aTexto(aplicar),
            estado,
        })
        restante = restante.minus(aplicar)
    }
    return { aplicaciones, aplicado: monto.minus(restante), restante }
}

/** Saldo de anticipos del cliente en el libro (haber − debe de su auxiliar en Anticipos). */
export async function saldoAnticipos(trx: QueryClientContract, clienteId: number): Promise<Dec> {
    const fila = (await trx
        .from('ledger.movimientos as m')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('c.codigo', CUENTAS.ANTICIPOS_CLIENTES)
        .where('m.cliente_id', clienteId)
        .select(
            trx.raw('coalesce(sum(m.debe), 0)::text as debe'),
            trx.raw('coalesce(sum(m.haber), 0)::text as haber'),
        )
        .first()) as { debe: string; haber: string }
    return dec(fila.haber).minus(dec(fila.debe))
}

/**
 * Aplica el anticipo del cliente (excedentes de pagos anteriores) a sus facturas pendientes, la
 * más antigua primero. Cada pago con remanente genera su aplicación y un asiento
 * `Anticipos / CxC` con origen en ese pago (así anularlo revierte también esta aplicación).
 * El cliente ya debe estar bloqueado (`bloquearCliente`).
 */
export async function aplicarAnticipos(t: Transaccion, clienteId: number): Promise<Aplicacion[]> {
    let disponible = await saldoAnticipos(t.trx, clienteId)
    if (disponible.lte(0)) return []
    const facturas = await facturasPendientes(t.trx, clienteId)
    if (facturas.length === 0) return []

    const pagos = (await t.trx
        .from('billing.pagos as p')
        .leftJoin('billing.pagos_aplicaciones as a', 'a.pago_id', 'p.id')
        .where('p.cliente_id', clienteId)
        .where('p.estado', 'registrado')
        .groupBy('p.id', 'p.monto')
        .havingRaw('p.monto > coalesce(sum(a.monto), 0)')
        .orderBy('p.id', 'asc')
        .select('p.id', t.trx.raw('(p.monto - coalesce(sum(a.monto), 0))::text as restante'))) as Array<{
        id: number
        restante: string
    }>

    const todas: Aplicacion[] = []
    for (const pago of pagos) {
        if (disponible.lte(0)) break
        const restante = dec(pago.restante)
        const usar = restante.lt(disponible) ? restante : disponible
        const { aplicaciones, aplicado } = await aplicarAFacturas(t.trx, pago.id, usar, facturas)
        if (aplicado.lte(0)) break
        await new RegistrarAsiento().execute(
            {
                descripcion: `Aplicación de anticipo del pago ${pago.id} a facturas ${aplicaciones
                    .map((a) => a.factura_id)
                    .join(', ')}`,
                origen_tipo: 'pago',
                origen_id: pago.id,
                movimientos: [
                    { cuenta: CUENTAS.ANTICIPOS_CLIENTES, debe: aTexto(aplicado), cliente_id: clienteId },
                    { cuenta: CUENTAS.CXC_CLIENTES, haber: aTexto(aplicado), cliente_id: clienteId },
                ],
            },
            t.ctx,
            { trx: t.trx },
        )
        todas.push(...aplicaciones)
        disponible = disponible.minus(aplicado)
    }
    return todas
}

/** Ids únicos de los servicios tocados por unas aplicaciones. */
export function serviciosDe(aplicaciones: Array<{ servicio_id: number | null }>): number[] {
    return [...new Set(aplicaciones.map((a) => a.servicio_id).filter((id): id is number => id !== null))]
}
