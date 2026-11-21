import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { dec, aTexto, tieneCentavosExactos } from '#ledger/dinero'
import EmitirCargoUnico from '#billing/actions/emitir_cargo_unico'
import CrearConceptoCargo from '#billing/actions/crear_concepto_cargo'

/**
 * Cola de cobros de equipo (contrato Iris 0.12.0 §3.10, A48): «Equipo no devuelto» y los cobros que un
 * técnico propone **sin monto** al cambiar un equipo. Los decide una persona con
 * `inventario.cobrar_equipo`; aprobar emite un cargo único al cliente del servicio (CxC / ingreso del
 * concepto + IVA), con el concepto indicado o el «Equipo no devuelto» de la empresa (se crea la primera
 * vez, cuenta 4.1.03, gravable).
 *
 * `GET /inventario/cobros-equipo` lista la cola: los cobros (propuestos, aprobados o rechazados) y las
 * unidades por recuperar con intentos que esperan que alguien las declare no recuperadas.
 */

export const CONCEPTO_EQUIPO_NO_DEVUELTO = 'Equipo no devuelto'

/** Concepto «Equipo no devuelto» de la empresa (lo crea si no existe). */
async function conceptoEquipoNoDevuelto(t: Transaccion, empresaId: number): Promise<number> {
    const fila = await t.trx
        .from('billing.conceptos_cargo')
        .where({ empresa_id: empresaId, nombre: CONCEPTO_EQUIPO_NO_DEVUELTO })
        .select('id')
        .first()
    if (fila) return Number(fila.id)
    const creado = await new CrearConceptoCargo().execute(
        {
            empresa_id: empresaId,
            nombre: CONCEPTO_EQUIPO_NO_DEVUELTO,
            tipo: 'producto',
            cuenta_codigo: '4.1.03',
        },
        t.ctx,
        { trx: t.trx },
    )
    return Number(creado.id)
}

/**
 * Aprueba un cobro de la cola: emite el cargo único y deja la fila `aprobado` con su monto y factura.
 * Devuelve la factura.
 */
export async function emitirCobroEquipo(
    t: Transaccion,
    cobroId: number,
    datos: { monto: string; concepto_id: number | null; decidido_por: number | null; motivo?: string | null },
): Promise<number> {
    const monto = dec(datos.monto)
    if (!monto.gt(0) || !tieneCentavosExactos(monto)) {
        throw new ValidacionFallida([
            { field: 'monto', message: 'Monto > 0 con hasta 2 decimales', rule: 'monto' },
        ])
    }
    const cobro = (await t.trx
        .from('inventario.cobros_equipo as c')
        .join('inventario.unidades as u', 'u.id', 'c.unidad_id')
        .join('inventario.productos as p', 'p.id', 'u.producto_id')
        .where('c.id', cobroId)
        .select('c.id', 'c.empresa_id', 'c.servicio_id', 'c.origen', 'u.serie', 'u.mac', 'p.nombre')
        .first()) as {
        id: number
        empresa_id: number
        servicio_id: number
        origen: string
        serie: string | null
        mac: string | null
        nombre: string
    }
    const empresaId = Number(cobro.empresa_id)
    const conceptoId = datos.concepto_id ?? (await conceptoEquipoNoDevuelto(t, empresaId))
    const equipo = `${cobro.nombre} ${cobro.serie ?? cobro.mac ?? ''}`.trim()
    const cargo = await new EmitirCargoUnico().execute(
        {
            servicio_id: Number(cobro.servicio_id),
            lineas: [
                {
                    concepto_id: conceptoId,
                    descripcion:
                        cobro.origen === 'no_recuperado'
                            ? `${CONCEPTO_EQUIPO_NO_DEVUELTO}: ${equipo}`
                            : `Cobro por el equipo ${equipo} (cambio de equipo)`,
                    precio_unitario: aTexto(monto),
                },
            ],
        },
        t.ctx,
        { trx: t.trx },
    )
    const facturaId = Number(cargo.id)
    await t.trx
        .from('inventario.cobros_equipo')
        .where('id', cobroId)
        .update({
            estado: 'aprobado',
            monto: aTexto(monto),
            factura_id: facturaId,
            decidido_por: datos.decidido_por,
            decidido_en: t.trx.knexRawQuery('now()'),
            motivo_decision: datos.motivo ?? null,
            version: t.trx.knexRawQuery('version + 1'),
            updated_at: t.trx.knexRawQuery('now()'),
        } as Record<string, unknown>)
    return facturaId
}

export interface CobroEquipoVista {
    id: number
    empresa_id: number
    unidad_id: number
    serie: string | null
    mac: string | null
    producto_nombre: string
    servicio_id: number
    cliente_id: number
    cliente_nombre: string
    origen: 'cambio_equipo' | 'no_recuperado'
    cambio_id: number | null
    motivo: string | null
    nota: string | null
    estado: 'propuesto' | 'aprobado' | 'rechazado'
    monto: string | null
    factura_id: number | null
    decidido_por: number | null
    decidido_en: Date | null
    motivo_decision: string | null
    version: number
    created_at: Date
}

function consultaCobros(cliente: QueryClientContract = db.connection()) {
    return cliente
        .from('inventario.cobros_equipo as c')
        .join('inventario.unidades as u', 'u.id', 'c.unidad_id')
        .join('inventario.productos as p', 'p.id', 'u.producto_id')
        .join('core.clientes as cl', 'cl.id', 'c.cliente_id')
        .select(
            'c.id',
            'c.empresa_id',
            'c.unidad_id',
            'u.serie',
            'u.mac',
            'p.nombre as producto_nombre',
            'c.servicio_id',
            'c.cliente_id',
            'cl.nombre as cliente_nombre',
            'c.origen',
            'c.cambio_id',
            'c.motivo',
            'c.nota',
            'c.estado',
            cliente.raw('c.monto::text as monto'),
            'c.factura_id',
            'c.decidido_por',
            'c.decidido_en',
            'c.motivo_decision',
            'c.version',
            'c.created_at',
        )
}

export async function verCobroEquipo(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<CobroEquipoVista> {
    const fila = (await consultaCobros(cliente).where('c.id', id).first()) as CobroEquipoVista | null
    if (!fila) throw new NoEncontrado(`El cobro de equipo ${id} no existe`)
    return fila
}

export interface FiltrosCobrosEquipo extends OpcionesPaginacion {
    estado?: 'propuesto' | 'aprobado' | 'rechazado'
}

export async function listarCobrosEquipo(filtros: FiltrosCobrosEquipo, empresas: number[] | null) {
    const q = consultaCobros().if(filtros.estado, (c) => c.where('c.estado', filtros.estado!))
    filtrarPorEmpresa(q, empresas, (c, ids) => c.whereIn('c.empresa_id', ids))
    return paginar<CobroEquipoVista>(q, filtros, { columna: 'c.id' })
}

export interface PendienteDeDeclarar {
    unidad_id: number
    empresa_id: number
    serie: string | null
    mac: string | null
    producto_nombre: string
    servicio_id: number
    cliente_id: number
    cliente_nombre: string
    intentos: number
    tecnicos_distintos: number
    contactos: number
    ultimo_intento: Date
}

/** Unidades por recuperar con intentos, que esperan que una persona las declare no recuperadas. */
export async function pendientesDeDeclarar(empresas: number[] | null): Promise<PendienteDeDeclarar[]> {
    const q = db
        .from('inventario.unidades as u')
        .join('inventario.productos as p', 'p.id', 'u.producto_id')
        .join('core.servicios as s', 's.id', 'u.servicio_id')
        .join('core.clientes as cl', 'cl.id', 's.cliente_id')
        .join('inventario.intentos_recuperacion as i', (j) =>
            j.on('i.unidad_id', 'u.id').andOn('i.servicio_id', 'u.servicio_id'),
        )
        .whereIn('u.estado', ['en_comodato', 'por_recuperar'])
        .groupBy('u.id', 'p.nombre', 's.id', 'cl.id', 'cl.nombre')
        .orderBy('u.id')
        .select(
            'u.id as unidad_id',
            'u.empresa_id',
            'u.serie',
            'u.mac',
            'p.nombre as producto_nombre',
            's.id as servicio_id',
            'cl.id as cliente_id',
            'cl.nombre as cliente_nombre',
            db.raw('count(*)::int as intentos'),
            db.raw(
                'count(distinct coalesce(i.actor_tecnico, i.actor_tecnico_id::text, i.registrado_por::text))::int as tecnicos_distintos',
            ),
            db.raw(
                '(select count(*)::int from inventario.contactos_recuperacion c where c.unidad_id = u.id) as contactos',
            ),
            db.raw('max(i.fecha) as ultimo_intento'),
        )
    filtrarPorEmpresa(q, empresas, (c, ids) => c.whereIn('u.empresa_id', ids))
    return (await q) as PendienteDeDeclarar[]
}
