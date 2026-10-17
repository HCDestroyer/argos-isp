import db from '@adonisjs/lucid/services/db'
import { NoEncontrado } from '#shared/errores'
import { listarEmpresas } from '#core/empresas'
import { CERO, aTexto, dec } from '#ledger/dinero'
import { CUENTAS } from '#ledger/plan_cuentas'
import { saldoCliente } from '#ledger/consultas'
import { saldoAnticipos } from '#billing/cobros'
import { ESTADOS_PENDIENTES, columnasFactura, type FacturaFila } from '#billing/facturas'

/**
 * Estado de cuenta del cliente (`GET /clientes/:id/estado-cuenta`): el **auxiliar CxC** del libro.
 *
 * - `saldo`: suma de los movimientos del cliente en CxC (debe − haber). Positivo = debe.
 * - `saldo_a_favor`: anticipos del cliente (excedentes de pagos aún sin aplicar).
 * - `facturas_pendientes`: emitidas, parciales y vencidas, la más antigua primero.
 * - `movimientos`: un renglón por asiento que toca su CxC, en orden contable (fecha, asiento),
 *   con `cargo` (debe), `abono` (haber) y el saldo acumulado; el último saldo es `saldo`.
 *   Los reversos aparecen con el tipo de su origen (p. ej. un pago anulado como cargo `pago`).
 */

type TipoMovimiento = 'factura' | 'pago' | 'mora' | 'nota_credito' | 'ajuste'

export interface MovimientoEstadoCuenta {
    /** empresa (libro) del asiento */
    empresa_id: number
    fecha: string
    tipo: TipoMovimiento
    referencia_id: number
    descripcion: string
    cargo: string
    abono: string
    saldo: string
}

/** Sección de una empresa: su auxiliar CxC, su saldo a favor y sus facturas (multiempresa). */
export interface SeccionEstadoCuenta {
    empresa_id: number
    nombre_comercial: string
    razon_social: string | null
    nit: string | null
    logo_url: string | null
    saldo: string
    saldo_a_favor: string
    facturas_pendientes: FacturaFila[]
    /** saldo acumulado dentro de la empresa */
    movimientos: MovimientoEstadoCuenta[]
}

export interface EstadoCuenta {
    cliente_id: number
    /** total de las empresas mostradas: solo informativo (cada NIT cobra lo suyo) */
    saldo: string
    saldo_a_favor: string
    facturas_pendientes: FacturaFila[]
    movimientos: MovimientoEstadoCuenta[]
    /** una sección por empresa con facturas o movimientos del cliente (dentro del alcance) */
    empresas: SeccionEstadoCuenta[]
}

const TIPOS: Record<string, TipoMovimiento> = {
    factura: 'factura',
    pago: 'pago',
    mora: 'mora',
    nota_credito: 'nota_credito',
}

/**
 * `empresas`: las empresas a mostrar (alcance del usuario o una pedida); null = todas.
 */
export async function estadoCuenta(
    clienteId: number,
    empresas: number[] | null = null,
): Promise<EstadoCuenta> {
    const cliente = await db.from('core.clientes').where('id', clienteId).select('id').first()
    if (!cliente) throw new NoEncontrado(`El cliente ${clienteId} no existe`)

    const conexion = db.connection()
    const facturas = (await conexion
        .from('billing.facturas as f')
        .where('f.cliente_id', clienteId)
        .whereIn('f.estado', [...ESTADOS_PENDIENTES])
        .if(empresas !== null, (q) => q.whereIn('f.empresa_id', empresas!))
        .orderBy([
            { column: 'f.vence_en', order: 'asc' },
            { column: 'f.periodo', order: 'asc' },
            { column: 'f.id', order: 'asc' },
        ])
        .select(...columnasFactura(conexion))) as FacturaFila[]

    const filas = (await db
        .from('ledger.movimientos as m')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        // pago de terceros: el movimiento del dueño dice quién pagó
        .leftJoin('billing.pagos as p', (j) =>
            j.on('p.id', 'a.origen_id').andOnVal('a.origen_tipo', '=', 'pago'),
        )
        .leftJoin('core.clientes as pagador', 'pagador.id', 'p.cliente_id')
        .where('c.codigo', CUENTAS.CXC_CLIENTES)
        .where('m.cliente_id', clienteId)
        .if(empresas !== null, (q) => q.whereIn('a.empresa_id', empresas!))
        .groupBy(
            'a.id',
            'a.empresa_id',
            'a.fecha',
            'a.origen_tipo',
            'a.origen_id',
            'a.descripcion',
            'p.id',
            'p.cliente_id',
            'pagador.nombre',
        )
        .orderBy([
            { column: 'a.fecha', order: 'asc' },
            { column: 'a.id', order: 'asc' },
        ])
        .select(
            'a.id',
            'a.empresa_id',
            db.raw(`to_char(a.fecha, 'YYYY-MM-DD') as fecha`),
            'a.origen_tipo',
            'a.origen_id',
            db.raw('case when p.cliente_id <> ? then p.id else null end as pago_tercero_id', [clienteId]),
            db.raw(
                "case when p.cliente_id is not null and p.cliente_id <> ? then a.descripcion || ' · pagado por ' || pagador.nombre else a.descripcion end as descripcion",
                [clienteId],
            ),
            db.raw('sum(m.debe)::text as cargo'),
            db.raw('sum(m.haber)::text as abono'),
        )) as Array<{
        id: number
        empresa_id: number
        fecha: string
        origen_tipo: string
        origen_id: number | null
        pago_tercero_id: number | null
        descripcion: string
        cargo: string
        abono: string
    }>

    const propias = await facturasPropiasDePagos(
        clienteId,
        filas.map((f) => f.pago_tercero_id).filter((id): id is number => id !== null),
    )
    let acumulado = CERO
    const movimientos = filas.map((fila) => {
        acumulado = acumulado.plus(dec(fila.cargo)).minus(dec(fila.abono))
        return {
            empresa_id: Number(fila.empresa_id),
            fecha: fila.fecha,
            tipo: TIPOS[fila.origen_tipo] ?? 'ajuste',
            referencia_id: fila.origen_id ?? fila.id,
            descripcion:
                fila.pago_tercero_id === null
                    ? fila.descripcion
                    : soloFacturasPropias(fila.descripcion, propias.get(fila.pago_tercero_id) ?? []),
            cargo: aTexto(fila.cargo),
            abono: aTexto(fila.abono),
            saldo: aTexto(acumulado),
        }
    })

    // secciones por empresa: las que tienen facturas pendientes o movimientos del cliente
    const ids = [
        ...new Set([
            ...facturas.map((f) => Number(f.empresa_id)),
            ...movimientos.map((m) => m.empresa_id),
            ...(await empresasConAnticipo(clienteId, empresas)),
        ]),
    ].sort((a, b) => a - b)
    const datos = await listarEmpresas({ ids })
    const secciones: SeccionEstadoCuenta[] = []
    let saldoTotal = CERO
    let aFavorTotal = CERO
    for (const empresaId of ids) {
        const empresa = datos.find((e) => e.id === empresaId)
        const saldo = await saldoCliente(clienteId, conexion, empresaId)
        const aFavor = await saldoAnticipos(conexion, clienteId, empresaId)
        saldoTotal = saldoTotal.plus(saldo)
        aFavorTotal = aFavorTotal.plus(aFavor)
        let propio = CERO
        secciones.push({
            empresa_id: empresaId,
            nombre_comercial: empresa?.nombre_comercial ?? `Empresa ${empresaId}`,
            razon_social: empresa?.razon_social ?? null,
            nit: empresa?.nit ?? null,
            logo_url: empresa?.logo_url ?? null,
            saldo: aTexto(saldo),
            saldo_a_favor: aTexto(aFavor),
            facturas_pendientes: facturas.filter((f) => Number(f.empresa_id) === empresaId),
            movimientos: movimientos
                .filter((m) => m.empresa_id === empresaId)
                .map((m) => {
                    propio = propio.plus(dec(m.cargo)).minus(dec(m.abono))
                    return { ...m, saldo: aTexto(propio) }
                }),
        })
    }

    return {
        cliente_id: clienteId,
        saldo: aTexto(saldoTotal),
        saldo_a_favor: aTexto(aFavorTotal),
        facturas_pendientes: facturas,
        movimientos,
        empresas: secciones,
    }
}

/** Empresas en las que el cliente tiene movimientos de anticipo. */
async function empresasConAnticipo(clienteId: number, empresas: number[] | null): Promise<number[]> {
    const filas = (await db
        .from('ledger.movimientos as m')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
        .where('c.codigo', CUENTAS.ANTICIPOS_CLIENTES)
        .where('m.cliente_id', clienteId)
        .if(empresas !== null, (q) => q.whereIn('a.empresa_id', empresas!))
        .distinct('a.empresa_id')) as Array<{ empresa_id: number }>
    return filas.map((f) => Number(f.empresa_id))
}

/**
 * Pago de terceros: en el estado de cuenta del dueño, la descripción del pago lista solo SUS
 * facturas (el asiento del pago nombra todas, también las del pagador).
 */
async function facturasPropiasDePagos(clienteId: number, pagos: number[]): Promise<Map<number, number[]>> {
    const mapa = new Map<number, number[]>()
    if (pagos.length === 0) return mapa
    const filas = (await db
        .from('billing.pagos_aplicaciones as a')
        .join('billing.facturas as f', 'f.id', 'a.factura_id')
        .whereIn('a.pago_id', [...new Set(pagos)])
        .where('f.cliente_id', clienteId)
        .groupBy('a.pago_id', 'a.factura_id')
        .orderBy([
            { column: 'a.pago_id', order: 'asc' },
            { column: 'a.factura_id', order: 'asc' },
        ])
        .select('a.pago_id', 'a.factura_id')) as Array<{ pago_id: number; factura_id: number }>
    for (const fila of filas) mapa.set(fila.pago_id, [...(mapa.get(fila.pago_id) ?? []), fila.factura_id])
    return mapa
}

export function soloFacturasPropias(descripcion: string, facturas: number[]): string {
    if (facturas.length === 0) return descripcion
    const texto = facturas.length === 1 ? `factura ${facturas[0]}` : `facturas ${facturas.join(', ')}`
    return descripcion.replace(/facturas? \d+(?:, \d+)*/, texto)
}
