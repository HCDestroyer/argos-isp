import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { Conflicto, NoEncontrado, ValidacionFallida } from '#shared/errores'
import { exigirAccesoEmpresa, filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { fechaValida, hoyGuatemala } from '#ledger/fechas'
import type { NombreEvento } from '#shared/eventos'
import { ultimaFechaDeUnidad, verUnidad, type UnidadFila, type UnidadVista } from '#inventario/unidades'

/**
 * Comodato (`contratos/inventario.md` §5, fase B): lo común de asignar, devolver, declarar pérdida y
 * marcar por recuperar, y las lecturas (`GET /servicios/:id/equipos`, equipos por recuperar).
 */

export interface ServicioComodato {
    id: number
    empresa_id: number
    cliente_id: number
    estado: string
}

/** El servicio (404 si no existe o es de otra empresa que la unidad). */
export async function servicioDe(
    t: Transaccion,
    servicioId: number,
    empresaId?: number,
): Promise<ServicioComodato> {
    const fila = (await t.trx
        .from('core.servicios')
        .where('id', servicioId)
        .select('id', 'empresa_id', 'cliente_id', 'estado')
        .first()) as ServicioComodato | null
    if (!fila || (empresaId !== undefined && Number(fila.empresa_id) !== empresaId)) {
        throw new NoEncontrado(`El servicio ${servicioId} no existe`)
    }
    exigirAccesoEmpresa(t.ctx, Number(fila.empresa_id))
    return {
        ...fila,
        id: Number(fila.id),
        empresa_id: Number(fila.empresa_id),
        cliente_id: Number(fila.cliente_id),
    }
}

/** Empresa de una unidad (404). */
export async function empresaDeLaUnidad(t: Transaccion, unidadId: number): Promise<number> {
    const fila = await t.trx.from('inventario.unidades').where('id', unidadId).select('empresa_id').first()
    if (!fila) throw new NoEncontrado(`La unidad ${unidadId} no existe`)
    exigirAccesoEmpresa(t.ctx, Number(fila.empresa_id))
    return Number(fila.empresa_id)
}

/**
 * Fecha de un movimiento de comodato: la dada (no futura) o hoy, y nunca antes del último movimiento
 * de la unidad (así la unidad no sale de donde todavía no estaba).
 */
export async function fechaDeComodato(
    t: Transaccion,
    unidadId: number,
    pedida?: string | null,
): Promise<string> {
    const hoy = hoyGuatemala()
    const fecha = pedida ? fechaValida(pedida) : hoy
    if (fecha > hoy) {
        throw new ValidacionFallida([
            { field: 'fecha', message: 'La fecha no puede ser futura', rule: 'futuro' },
        ])
    }
    const ultima = await ultimaFechaDeUnidad(t, unidadId)
    if (ultima && fecha < ultima) {
        throw new ValidacionFallida([
            {
                field: 'fecha',
                message: `La unidad tiene un movimiento del ${ultima}: la fecha no puede ser anterior`,
                rule: 'fecha_anterior',
            },
        ])
    }
    return fecha
}

/** La unidad en comodato (o por recuperar) en ese servicio; 409 si no. */
export function exigirEnComodatoDe(unidad: UnidadFila, servicioId: number): void {
    if (!['en_comodato', 'por_recuperar'].includes(unidad.estado) || unidad.servicio_id !== servicioId) {
        throw new Conflicto(
            `La unidad ${unidad.serie ?? unidad.mac} no está en comodato en el servicio ${servicioId}`,
            'unidad_sin_comodato',
            'Unidad sin comodato',
        )
    }
}

/** Evento de comodato con su payload común. */
export async function emitirComodato<E extends NombreEvento>(
    t: Transaccion,
    evento: E,
    unidad: Pick<UnidadFila, 'id' | 'empresa_id' | 'producto_id' | 'serie' | 'mac'>,
    servicio: ServicioComodato,
    extra: Record<string, unknown> = {},
): Promise<void> {
    await t.emit(evento, {
        unidad_id: unidad.id,
        empresa_id: unidad.empresa_id,
        servicio_id: servicio.id,
        cliente_id: servicio.cliente_id,
        producto_id: unidad.producto_id,
        serie: unidad.serie,
        mac: unidad.mac,
        ...extra,
    } as never)
}

/** Unidad (vista) después de la acción. */
export function unidadVista(id: number, t: Transaccion): Promise<UnidadVista> {
    return verUnidad(id, t.trx)
}

/*
|--------------------------------------------------------------------------
| Lectura
|--------------------------------------------------------------------------
*/

export interface EquipoServicio extends UnidadVista {
    /** valor en libros del activo (costo − depreciación acumulada) */
    valor_libros: string | null
    fecha_asignacion: string | null
}

function consultaEquipos(cliente: QueryClientContract) {
    return cliente
        .from('inventario.unidades as u')
        .join('inventario.productos as p', 'p.id', 'u.producto_id')
        .join('core.servicios as s', 's.id', 'u.servicio_id')
        .leftJoin('ledger.activos as ac', 'ac.id', 'u.activo_id')
        .whereIn('u.estado', ['en_comodato', 'por_recuperar'])
        .select(
            'u.id',
            'u.empresa_id',
            'u.producto_id',
            'p.sku as producto_sku',
            'p.nombre as producto_nombre',
            'u.serie',
            'u.mac',
            'u.estado',
            'u.condicion',
            'u.bodega_id',
            cliente.raw('NULL::text as bodega_nombre'),
            cliente.raw('u.costo::text as costo'),
            'u.servicio_id',
            's.cliente_id',
            'u.activo_id',
            'u.compra_id',
            'u.version',
            'u.created_at',
            'u.updated_at',
            cliente.raw(
                `(ac.costo - ac.depreciacion_inicial - coalesce((SELECT sum(q.monto) FROM ledger.activos_cuotas q
                    WHERE q.activo_id = ac.id AND NOT EXISTS (SELECT 1 FROM ledger.asientos r WHERE r.reversa_de = q.asiento_id)), 0))::numeric(14,2)::text as valor_libros`,
            ),
            cliente.raw(`to_char(ac.fecha_alta, 'YYYY-MM-DD') as fecha_asignacion`),
        )
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function normalizarEquipo(f: EquipoServicio): EquipoServicio {
    return {
        ...f,
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        producto_id: Number(f.producto_id),
        servicio_id: n(f.servicio_id),
        cliente_id: n(f.cliente_id),
        activo_id: n(f.activo_id),
        compra_id: n(f.compra_id),
        bodega_id: null,
        version: Number(f.version),
    }
}

/** Equipos en comodato (o por recuperar) de un servicio. */
export async function equiposDelServicio(servicioId: number): Promise<EquipoServicio[]> {
    const filas = (await consultaEquipos(db.connection())
        .where('u.servicio_id', servicioId)
        .orderBy('u.id')) as EquipoServicio[]
    return filas.map(normalizarEquipo)
}

export interface FiltrosPorRecuperar extends OpcionesPaginacion {
    cliente_id?: number
    producto_id?: number
}

/** Reporte de equipos por recuperar (servicios retirados con equipo en casa del cliente). */
export async function equiposPorRecuperar(filtros: FiltrosPorRecuperar, empresas: number[] | null) {
    const q = consultaEquipos(db.connection())
        .where('u.estado', 'por_recuperar')
        .if(filtros.cliente_id, (c) => c.where('s.cliente_id', filtros.cliente_id!))
        .if(filtros.producto_id, (c) => c.where('u.producto_id', filtros.producto_id!))
    filtrarPorEmpresa(q, empresas, (c, ids) => c.whereIn('u.empresa_id', ids))
    const pagina = await paginar<EquipoServicio>(q, filtros, { columna: 'u.id' })
    return { data: pagina.data.map(normalizarEquipo), nextCursor: pagina.nextCursor }
}
