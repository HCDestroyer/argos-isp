import type { QueryClientContract, TransactionClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { Conflicto, ValidacionFallida } from '#shared/errores'
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
    /** empresa (NIT) de la factura: un pago solo aplica a facturas de su empresa */
    empresa_id: number
    /** dueño de la factura (puede no ser el pagador: pago de terceros) */
    cliente_id: number
    servicio_id: number | null
    total: string
    pagado: string
    vencida_en: Date | null
}

const COLUMNAS_PENDIENTE = ['id', 'empresa_id', 'cliente_id', 'servicio_id', 'total', 'pagado', 'vencida_en']

/** Dueños de unas facturas (para bloquearlos antes de aplicar un pago de terceros). */
export async function duenosDeFacturas(trx: TransactionClientContract, ids: number[]): Promise<number[]> {
    if (ids.length === 0) return []
    const filas = (await trx.from('billing.facturas').whereIn('id', ids).distinct('cliente_id')) as Array<{
        cliente_id: number
    }>
    return filas.map((f) => f.cliente_id)
}

/** Bloquea varios clientes en orden ascendente (sin interbloqueos entre cobros cruzados). */
export async function bloquearClientes(trx: TransactionClientContract, ids: number[]): Promise<void> {
    for (const id of [...new Set(ids)].sort((a, b) => a - b)) await bloquearCliente(trx, id)
}

/**
 * Facturas con saldo, bloqueadas, en el orden de aplicación: primero las `preferidas` en el
 * orden pedido (de cualquier cliente: pago de terceros), luego las del pagador de la más antigua a
 * la más nueva (vencimiento, periodo, id). Una preferida inexistente o sin saldo → 422 con el
 * índice (`facturas.<i>`). Los dueños ya deben estar bloqueados (`bloquearClientes`).
 *
 * `empresas` (multiempresa): solo las facturas del pagador de esas empresas (las preferidas se
 * devuelven igual y quien llama revisa su empresa); `null` = de todas.
 */
export async function facturasPendientes(
    trx: TransactionClientContract,
    clienteId: number,
    preferidas: number[] = [],
    empresas: number[] | null = null,
): Promise<FacturaPendiente[]> {
    // H6: un documento con la anulación de su DTE pendiente no recibe pagos (se anula en dos pasos)
    if (preferidas.length > 0) {
        const enAnulacion = (await trx
            .from('fiscal.dte')
            .whereIn('documento_tipo', ['factura', 'nota_debito'])
            .whereIn('documento_id', preferidas)
            .where('estado', 'anulacion_pendiente')
            .select('documento_id')) as Array<{ documento_id: number }>
        if (enAnulacion.length > 0) {
            throw new Conflicto(
                `La anulación del DTE de las facturas ${enAnulacion
                    .map((d) => d.documento_id)
                    .join(', ')} está pendiente con el certificador: no admiten pagos`,
                'anulacion_en_proceso',
                'Anulación en proceso',
            )
        }
    }
    const filas = (await trx
        .from('billing.facturas')
        .where('cliente_id', clienteId)
        .whereIn('estado', ['emitida', 'parcial', 'vencida'])
        .whereNotExists((q) =>
            q
                .from('fiscal.dte as d')
                .whereRaw('d.documento_id = billing.facturas.id')
                .whereIn('d.documento_tipo', ['factura', 'nota_debito'])
                .where('d.estado', 'anulacion_pendiente'),
        )
        .if(empresas !== null, (q) => q.whereIn('empresa_id', empresas!))
        .orderBy([
            { column: 'vence_en', order: 'asc' },
            { column: 'periodo', order: 'asc' },
            { column: 'id', order: 'asc' },
        ])
        .forUpdate()
        .select(...COLUMNAS_PENDIENTE)) as FacturaPendiente[]

    if (preferidas.length === 0) return filas
    const ajenas = (await trx
        .from('billing.facturas')
        .whereIn('id', preferidas)
        .where((q) => {
            q.whereNot('cliente_id', clienteId)
            if (empresas !== null) q.orWhereNotIn('empresa_id', empresas)
        })
        .whereIn('estado', ['emitida', 'parcial', 'vencida'])
        .orderBy('id', 'asc')
        .forUpdate()
        .select(...COLUMNAS_PENDIENTE)) as FacturaPendiente[]
    const porId = new Map([...filas, ...ajenas].map((f) => [f.id, f]))
    const errores = preferidas
        .map((id, i) => ({ id, i }))
        .filter(({ id }) => !porId.has(id))
        .map(({ id, i }) => ({
            field: `facturas.${i}`,
            message: `La factura ${id} no existe o no tiene saldo pendiente`,
            rule: 'factura_pendiente',
        }))
    if (errores.length > 0) throw new ValidacionFallida(errores)
    const primero = [...new Set(preferidas)].map((id) => porId.get(id)!)
    return [...primero, ...filas.filter((f) => !preferidas.includes(f.id))]
}

export interface Aplicacion {
    factura_id: number
    empresa_id: number
    cliente_id: number
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
/**
 * De dónde sale el dinero aplicado: un pago, un saldo inicial a favor (importación) o el saldo a favor
 * de una nota de crédito (`notas_credito.a_favor`).
 */
export type FuenteAplicacion = number | { saldo_inicial_id: number } | { nota_credito_id: number }

export async function aplicarAFacturas(
    trx: TransactionClientContract,
    fuente: FuenteAplicacion,
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
            .table(
                typeof fuente === 'number'
                    ? 'billing.pagos_aplicaciones'
                    : 'saldo_inicial_id' in fuente
                      ? 'billing.saldos_iniciales_aplicaciones'
                      : 'billing.notas_credito_aplicaciones',
            )
            .insert({
                ...(typeof fuente === 'number' ? { pago_id: fuente } : fuente),
                factura_id: factura.id,
                monto: aTexto(aplicar),
            })
        const estado = await sumarAPagado(trx, factura, aplicar)
        aplicaciones.push({
            factura_id: factura.id,
            empresa_id: Number(factura.empresa_id),
            cliente_id: factura.cliente_id,
            servicio_id: factura.servicio_id,
            monto: aTexto(aplicar),
            estado,
        })
        restante = restante.minus(aplicar)
    }
    return { aplicaciones, aplicado: monto.minus(restante), restante }
}

/**
 * Saldo de anticipos del cliente en el libro (haber − debe de su auxiliar en Anticipos). El saldo
 * a favor es por empresa: `empresaId` = el de esa empresa; sin ella, la suma de todas (informativo).
 */
export async function saldoAnticipos(
    trx: QueryClientContract,
    clienteId: number,
    empresaId: number | null = null,
): Promise<Dec> {
    const fila = (await trx
        .from('ledger.movimientos as m')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .where('c.codigo', CUENTAS.ANTICIPOS_CLIENTES)
        .where('m.cliente_id', clienteId)
        .if(empresaId !== null, (q) => q.where('a.empresa_id', empresaId!))
        .select(
            trx.raw('coalesce(sum(m.debe), 0)::text as debe'),
            trx.raw('coalesce(sum(m.haber), 0)::text as haber'),
        )
        .first()) as { debe: string; haber: string }
    return dec(fila.haber).minus(dec(fila.debe))
}

/** Empresas en las que el cliente tiene movimientos de anticipo (para aplicar sin empresa). */
async function empresasConAnticipo(trx: QueryClientContract, clienteId: number): Promise<number[]> {
    const filas = (await trx
        .from('ledger.movimientos as m')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .where('c.codigo', CUENTAS.ANTICIPOS_CLIENTES)
        .where('m.cliente_id', clienteId)
        .groupBy('a.empresa_id')
        .havingRaw('sum(m.haber) > sum(m.debe)')
        .orderBy('a.empresa_id', 'asc')
        .select('a.empresa_id')) as Array<{ empresa_id: number }>
    return filas.map((f) => Number(f.empresa_id))
}

/**
 * Aplica el anticipo del cliente (excedentes de pagos anteriores y saldos iniciales a favor de la
 * importación) a sus facturas pendientes, la más antigua primero. Por empresa: el anticipo de una
 * empresa solo paga facturas de esa empresa (`empresaId`; null = cada empresa con anticipo). Cada pago con remanente genera
 * su aplicación y un asiento `Anticipos / CxC` con origen en ese pago (así anularlo revierte
 * también esta aplicación); cada saldo inicial a favor, su aplicación y un asiento `ajuste` con
 * origen en el saldo inicial.
 * El cliente ya debe estar bloqueado (`bloquearCliente`).
 */
export async function aplicarAnticipos(
    t: Transaccion,
    clienteId: number,
    empresaId: number | null,
): Promise<Aplicacion[]> {
    if (empresaId === null) {
        const todas: Aplicacion[] = []
        for (const id of await empresasConAnticipo(t.trx, clienteId)) {
            todas.push(...(await aplicarAnticipos(t, clienteId, id)))
        }
        return todas
    }
    let disponible = await saldoAnticipos(t.trx, clienteId, empresaId)
    if (disponible.lte(0)) return []
    const facturas = await facturasPendientes(t.trx, clienteId, [], [empresaId])
    if (facturas.length === 0) return []

    const pagos = (await t.trx
        .from('billing.pagos as p')
        .leftJoin('billing.pagos_aplicaciones as a', 'a.pago_id', 'p.id')
        .where('p.cliente_id', clienteId)
        .where('p.empresa_id', empresaId)
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
                empresa_id: empresaId,
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

    // saldos iniciales a favor (importación), después de los pagos
    const saldos = (await t.trx
        .from('billing.saldos_iniciales as s')
        .leftJoin('billing.saldos_iniciales_aplicaciones as a', 'a.saldo_inicial_id', 's.id')
        .where('s.cliente_id', clienteId)
        .where('s.empresa_id', empresaId)
        .where('s.monto', '<', 0)
        .whereNull('s.anulado_en')
        .groupBy('s.id', 's.monto')
        .havingRaw('-s.monto > coalesce(sum(a.monto), 0)')
        .orderBy('s.id', 'asc')
        .select('s.id', t.trx.raw('(-s.monto - coalesce(sum(a.monto), 0))::text as restante'))) as Array<{
        id: number
        restante: string
    }>
    for (const saldo of saldos) {
        if (disponible.lte(0)) break
        const restante = dec(saldo.restante)
        const usar = restante.lt(disponible) ? restante : disponible
        const { aplicaciones, aplicado } = await aplicarAFacturas(
            t.trx,
            { saldo_inicial_id: saldo.id },
            usar,
            facturas,
        )
        if (aplicado.lte(0)) break
        await new RegistrarAsiento().execute(
            {
                empresa_id: empresaId,
                descripcion: `Aplicación del saldo inicial a favor ${saldo.id} a facturas ${aplicaciones
                    .map((a) => a.factura_id)
                    .join(', ')}`,
                origen_tipo: 'ajuste',
                origen_id: saldo.id,
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

    // saldos a favor de notas de crédito (lealtad §15.2), después de pagos y saldos iniciales
    const notas = (await t.trx
        .from('billing.notas_credito as n')
        .leftJoin('billing.notas_credito_aplicaciones as a', 'a.nota_credito_id', 'n.id')
        .where('n.cliente_id', clienteId)
        .where('n.empresa_id', empresaId)
        .where('n.a_favor', '>', 0)
        .whereNotExists((q) => q.from('billing.notas_credito_anulaciones as x').whereRaw('x.nota_id = n.id'))
        .groupBy('n.id', 'n.a_favor')
        .havingRaw('n.a_favor > coalesce(sum(a.monto), 0)')
        .orderBy('n.id', 'asc')
        .select('n.id', t.trx.raw('(n.a_favor - coalesce(sum(a.monto), 0))::text as restante'))) as Array<{
        id: number
        restante: string
    }>
    for (const nota of notas) {
        if (disponible.lte(0)) break
        const restante = dec(nota.restante)
        const usar = restante.lt(disponible) ? restante : disponible
        const { aplicaciones, aplicado } = await aplicarAFacturas(
            t.trx,
            { nota_credito_id: Number(nota.id) },
            usar,
            facturas,
        )
        if (aplicado.lte(0)) break
        await new RegistrarAsiento().execute(
            {
                empresa_id: empresaId,
                descripcion: `Aplicación del saldo a favor de la nota de crédito ${nota.id} a facturas ${aplicaciones
                    .map((a) => a.factura_id)
                    .join(', ')}`,
                origen_tipo: 'nota_credito',
                origen_id: Number(nota.id),
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

/** Pagador primero y luego los dueños de las facturas aplicadas (payload `clientes` de pago.*). */
export function clientesDelPago(pagadorId: number, aplicaciones: Array<{ cliente_id: number }>): number[] {
    return [...new Set([pagadorId, ...aplicaciones.map((a) => a.cliente_id)])]
}
