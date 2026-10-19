import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'

/**
 * Constancias de retención (contrato de localización fiscal §3.4): las **recibidas** de clientes
 * (con su pago, `POST /pagos` con `retenciones[]`) y las **emitidas** a proveedores (con su compra,
 * `POST /compras/:id/constancias`). Solo inserción. Lectura.
 *
 * Una recibida de un pago anulado sigue en la tabla (inmutable) con `vigente = false`: su número
 * queda libre para otro pago.
 */

export interface ConstanciaVista {
    id: number
    empresa_id: number
    direccion: 'recibida' | 'emitida'
    impuesto: 'iva' | 'isr'
    impuesto_codigo: string
    numero: string
    fecha: string
    monto: string
    pago_id: number | null
    cliente_id: number | null
    cliente_nombre: string | null
    compra_id: number | null
    proveedor_id: number | null
    proveedor_nombre: string | null
    /** el pago o la compra sigue vigente */
    vigente: boolean
    registrado_por: number | null
    created_at: Date
}

function consulta(cliente: QueryClientContract) {
    return cliente
        .from('ledger.constancias_retencion as k')
        .leftJoin('core.clientes as cl', 'cl.id', 'k.cliente_id')
        .leftJoin('ledger.proveedores as pv', 'pv.id', 'k.proveedor_id')
        .leftJoin('billing.pagos as p', 'p.id', 'k.pago_id')
        .select(
            'k.id',
            'k.empresa_id',
            'k.direccion',
            'k.impuesto',
            'k.impuesto_codigo',
            'k.numero',
            cliente.raw(`to_char(k.fecha, 'YYYY-MM-DD') as fecha`),
            'k.monto',
            'k.pago_id',
            'k.cliente_id',
            'cl.nombre as cliente_nombre',
            'k.compra_id',
            'k.proveedor_id',
            'pv.nombre as proveedor_nombre',
            cliente.raw(
                `CASE WHEN k.direccion = 'recibida' THEN p.estado = 'registrado'
                      ELSE NOT EXISTS (SELECT 1 FROM ledger.compras_anulaciones x WHERE x.compra_id = k.compra_id) END as vigente`,
            ),
            'k.registrado_por',
            'k.created_at',
        )
}

function normalizar(fila: ConstanciaVista): ConstanciaVista {
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    return {
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        pago_id: n(fila.pago_id),
        cliente_id: n(fila.cliente_id),
        compra_id: n(fila.compra_id),
        proveedor_id: n(fila.proveedor_id),
    }
}

export async function verConstancia(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consulta(cliente).where('k.id', id).first()) as ConstanciaVista | null
    if (!fila) throw new NoEncontrado(`La constancia ${id} no existe`)
    return normalizar(fila)
}

export interface FiltrosConstancias extends OpcionesPaginacion {
    direccion?: 'recibida' | 'emitida'
    impuesto?: 'iva' | 'isr'
    desde?: string
    hasta?: string
    vigente?: boolean
}

export async function listarConstancias(filtros: FiltrosConstancias, empresas: number[] | null) {
    const q = consulta(db.connection())
        .if(filtros.direccion, (x) => x.where('k.direccion', filtros.direccion!))
        .if(filtros.impuesto, (x) => x.where('k.impuesto', filtros.impuesto!))
        .if(filtros.desde, (x) => x.where('k.fecha', '>=', filtros.desde!))
        .if(filtros.hasta, (x) => x.where('k.fecha', '<=', filtros.hasta!))
        .if(filtros.vigente !== undefined, (x) =>
            x.whereRaw(
                `(CASE WHEN k.direccion = 'recibida' THEN p.estado = 'registrado'
                       ELSE NOT EXISTS (SELECT 1 FROM ledger.compras_anulaciones x WHERE x.compra_id = k.compra_id) END) = ?`,
                [filtros.vigente!],
            ),
        )
    filtrarPorEmpresa(q, empresas, (x, ids) => x.whereIn('k.empresa_id', ids))
    const pagina = await paginar<ConstanciaVista>(q, filtros, { columna: 'k.id' })
    return { ...pagina, data: pagina.data.map(normalizar) }
}
