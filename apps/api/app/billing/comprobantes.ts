import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { filtrarPorAlcance, type Alcance, type FiltrosDimension } from '#core/acl'
import { dimensionesDeCliente } from '#core/consultas/clientes'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import type { TipoComprobante } from '#billing/comprobantes_archivos'

/**
 * Comprobantes de depósito: lectura (cola del panel, detalle). Las acciones están en
 * `actions/registrar_comprobante.ts`, `aprobar_comprobante.ts` y `rechazar_comprobante.ts`.
 */

export const METODOS_COMPROBANTE = ['deposito', 'transferencia', 'ach', 'remesa'] as const
export type MetodoComprobante = (typeof METODOS_COMPROBANTE)[number]

export const ESTADOS_COMPROBANTE = ['pendiente', 'aprobado', 'rechazado'] as const
export type EstadoComprobante = (typeof ESTADOS_COMPROBANTE)[number]

export const CANALES_COMPROBANTE = ['portal', 'panel'] as const
export type CanalComprobante = (typeof CANALES_COMPROBANTE)[number]

export interface ComprobanteVista {
    id: number
    cliente_id: number
    cliente_nombre: string
    servicio_id: number | null
    metodo: MetodoComprobante
    cuenta_bancaria_id: number
    cuenta_bancaria_nombre: string
    banco_origen_id: number | null
    banco_origen_nombre: string | null
    referencia: string
    monto: string
    /** YYYY-MM-DD */
    fecha_deposito: string
    archivo_tipo: TipoComprobante
    archivo_tamano: number
    archivo_nombre: string | null
    canal: CanalComprobante
    nota: string | null
    estado: EstadoComprobante
    motivo_rechazo: string | null
    pago_id: number | null
    registrado_por: number | null
    verificado_por: number | null
    verificado_en: Date | null
    version: number
    created_at: Date
    updated_at: Date
}

function consulta(cliente: QueryClientContract) {
    return cliente
        .from('billing.comprobantes as k')
        .join('core.clientes as c', 'c.id', 'k.cliente_id')
        .join('billing.cuentas_bancarias as cb', 'cb.id', 'k.cuenta_bancaria_id')
        .join('billing.bancos as bd', 'bd.id', 'cb.banco_id')
        .leftJoin('billing.bancos as bo', 'bo.id', 'k.banco_origen_id')
        .select(
            'k.id',
            'k.cliente_id',
            'c.nombre as cliente_nombre',
            'k.servicio_id',
            'k.metodo',
            'k.cuenta_bancaria_id',
            cliente.raw(`bd.nombre || ' · ' || cb.alias as cuenta_bancaria_nombre`),
            'k.banco_origen_id',
            'bo.nombre as banco_origen_nombre',
            'k.referencia',
            'k.monto',
            cliente.raw(`to_char(k.fecha_deposito, 'YYYY-MM-DD') as fecha_deposito`),
            'k.archivo_tipo',
            'k.archivo_tamano',
            'k.archivo_nombre',
            'k.canal',
            'k.nota',
            'k.estado',
            'k.motivo_rechazo',
            'k.pago_id',
            'k.registrado_por',
            'k.verificado_por',
            'k.verificado_en',
            'k.version',
            'k.created_at',
            'k.updated_at',
        )
}

export async function verComprobante(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<ComprobanteVista> {
    const fila = (await consulta(cliente).where('k.id', id).first()) as ComprobanteVista | null
    if (!fila) throw new NoEncontrado(`El comprobante ${id} no existe`)
    return fila
}

export interface FiltrosComprobantes extends OpcionesPaginacion {
    estado?: EstadoComprobante
    cliente_id?: number
}

/** Alcance: zona del cliente o router de alguno de sus servicios (igual que el cliente). */
const dimensionesComprobante: FiltrosDimension = {
    zona: (q, ids) => q.whereIn('c.zona_id', ids),
    router: (q, ids) =>
        q.whereExists((s) =>
            s
                .from('core.servicios as s')
                .whereColumn('s.cliente_id', 'k.cliente_id')
                .whereIn('s.router_id', ids),
        ),
}

export async function listarComprobantes(filtros: FiltrosComprobantes, alcance?: Alcance) {
    const lista = consulta(db.connection())
        .if(filtros.estado, (q) => q.where('k.estado', filtros.estado!))
        .if(filtros.cliente_id, (q) => q.where('k.cliente_id', filtros.cliente_id!))
    filtrarPorAlcance(lista, alcance, dimensionesComprobante)
    return paginar<ComprobanteVista>(lista, filtros, { columna: 'k.id' })
}

/** Dimensiones de alcance de un comprobante: las de su cliente. */
export async function dimensionesDeComprobante(id: number) {
    const fila = await db.from('billing.comprobantes').where('id', id).select('cliente_id').first()
    if (!fila) throw new NoEncontrado(`El comprobante ${id} no existe`)
    return dimensionesDeCliente(fila.cliente_id as number)
}

/** Ruta y tipo del archivo de un comprobante (para `GET /comprobantes/:id/archivo`). */
export async function archivoDeComprobante(id: number) {
    const fila = (await db
        .from('billing.comprobantes')
        .where('id', id)
        .select('archivo', 'archivo_tipo', 'archivo_nombre')
        .first()) as { archivo: string; archivo_tipo: TipoComprobante; archivo_nombre: string | null } | null
    if (!fila) throw new NoEncontrado(`El comprobante ${id} no existe`)
    return fila
}
