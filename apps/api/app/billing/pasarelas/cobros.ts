import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import type { EstadoCobroProveedor } from '#billing/pasarelas/pasarela'

/** Lectura de cobros en línea y conciliaciones. */

export interface CobroPasarelaVista {
    id: number
    /** el pago en línea es de una sola empresa */
    empresa_id: number
    proveedor: string
    id_proveedor: string | null
    cliente_id: number
    cliente_nombre: string
    servicio_id: number | null
    monto: string
    facturas: number[]
    estado: EstadoCobroProveedor
    url_pago: string | null
    url_retorno: string | null
    expira_en: Date | null
    canal: string
    pago_id: number | null
    monto_pagado: string | null
    comision: string
    pagado_en: Date | null
    conciliado_en: Date | null
    version: number
    created_at: Date
    updated_at: Date
}

function consultaCobros(cliente: QueryClientContract) {
    return cliente
        .from('billing.pasarela_cobros as pc')
        .join('core.clientes as c', 'c.id', 'pc.cliente_id')
        .select(
            'pc.id',
            'pc.empresa_id',
            'pc.proveedor',
            'pc.id_proveedor',
            'pc.cliente_id',
            'c.nombre as cliente_nombre',
            'pc.servicio_id',
            'pc.monto',
            cliente.raw('pc.facturas::int[] as facturas'),
            'pc.estado',
            'pc.url_pago',
            'pc.url_retorno',
            'pc.expira_en',
            'pc.canal',
            'pc.pago_id',
            'pc.monto_pagado',
            'pc.comision',
            'pc.pagado_en',
            'pc.conciliado_en',
            'pc.version',
            'pc.created_at',
            'pc.updated_at',
        )
}

export async function verCobroPasarela(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaCobros(cliente).where('pc.id', id).first()) as CobroPasarelaVista | null
    if (!fila) throw new NoEncontrado(`El cobro en línea ${id} no existe`)
    return fila
}

export async function listarCobrosPasarela(
    filtros: OpcionesPaginacion & { cliente_id?: number; estado?: EstadoCobroProveedor },
    empresas: number[] | null = null,
) {
    const consulta = consultaCobros(db.connection())
        .if(filtros.cliente_id, (q) => q.where('pc.cliente_id', filtros.cliente_id!))
        .if(filtros.estado, (q) => q.where('pc.estado', filtros.estado!))
        .if(empresas !== null, (q) => q.whereIn('pc.empresa_id', empresas!))
    return paginar<CobroPasarelaVista>(consulta, filtros, { columna: 'pc.id' })
}

export async function dimensionesDeCobroPasarela(id: number) {
    const fila = await db
        .from('billing.pasarela_cobros as pc')
        .join('core.clientes as c', 'c.id', 'pc.cliente_id')
        .where('pc.id', id)
        .select('c.zona_id', 'pc.empresa_id')
        .first()
    if (!fila) throw new NoEncontrado(`El cobro en línea ${id} no existe`)
    return { zona: [fila.zona_id as number | null], empresa_id: Number(fila.empresa_id) }
}

export async function listarConciliaciones(filtros: OpcionesPaginacion & { fecha?: string }) {
    const consulta = db
        .from('billing.pasarela_conciliaciones as pz')
        .if(filtros.fecha, (q) => q.where('pz.fecha', filtros.fecha!))
        .select(
            'pz.id',
            'pz.proveedor',
            db.raw(`to_char(pz.fecha, 'YYYY-MM-DD') as fecha`),
            'pz.revisados',
            'pz.conciliados',
            'pz.diferencias',
            db.raw('pz.cobros_conciliados::int[] as cobros_conciliados'),
            'pz.ejecutado_por',
            'pz.created_at',
        )
    return paginar(consulta, filtros, { columna: 'pz.id' })
}
