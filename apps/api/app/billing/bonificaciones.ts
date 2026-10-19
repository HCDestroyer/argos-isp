import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import type { Transaccion } from '#shared/domain_action'
import { usuarioDelActor } from '#shared/contexto'
import { NoEncontrado, ValidacionFallida } from '#shared/errores'
import { paginar, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { filtrarPorAlcance, type Alcance } from '#core/acl'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'
import { hoyGuatemala } from '#ledger/fechas'
import RegistrarAsiento from '#ledger/actions/registrar_asiento'
import { movimientosFactura } from '#billing/emision'
import { dimensionesFactura, type LineaCalculada } from '#billing/facturas'

/**
 * Bonificaciones (decisión del PM, 19 oct): **una factura de valor 0 nunca se genera**. Lo que antes
 * era una factura de Q0 (mes gratis, descuento del 100 %, cargo único sin costo, canje) se registra
 * aquí, en `billing.bonificaciones` (solo inserción):
 *
 * - Servicio o cliente, periodo, concepto, bruto (con IVA), base (sin IVA), las líneas (copia), motivo
 *   del catálogo de su empresa (`billing.motivos_sin_costo`, obligatorio) y origen.
 * - Su único asiento es el interno `5.1.01 Descuentos / ingreso` por la base (bruto sin IVA), origen
 *   `bonificacion`: sin CxC, sin IVA, sin DTE, sin folio ni documento para el cliente.
 * - `clave_unica` comparte espacio con las facturas (trigger): con `servicio_id-periodo` el periodo
 *   queda ocupado y el cron no lo vuelve a facturar.
 * - Evento `bonificacion.registrada`.
 */

export const ORIGENES_BONIFICACION = ['mes_gratis', 'descuento_100', 'cargo_sin_costo', 'canje'] as const
export type OrigenBonificacion = (typeof ORIGENES_BONIFICACION)[number]

/** Motivo del catálogo que usan los canjes de lealtad (sembrado en cada empresa). */
export const MOTIVO_CANJE = 'Canje de lealtad'
/** Motivo de un descuento del 100 % pedido al emitir sin motivo propio. */
export const MOTIVO_PROMOCION = 'Promoción'

export interface DatosBonificacion {
    empresa_id: number
    cliente_id: number
    servicio_id: number | null
    periodo: string
    clave_unica: string
    concepto: string
    origen: OrigenBonificacion
    lineas: LineaCalculada[]
    motivo_id: number
    motivo_texto: string
    canje_id?: number | null
    reglas_snapshot?: Record<string, unknown>
}

export interface BonificacionVista {
    id: number
    empresa_id: number
    cliente_id: number
    servicio_id: number | null
    periodo: string
    clave_unica: string
    concepto: string
    origen: OrigenBonificacion
    bruto: string
    base: string
    lineas: Array<
        Pick<
            LineaCalculada,
            'concepto' | 'tipo' | 'cantidad' | 'precio_unitario' | 'gravable' | 'iva' | 'total'
        >
    >
    motivo_id: number
    motivo_nombre: string
    motivo_texto: string
    canje_id: number | null
    asiento_id: number
    created_at: Date
}

/** Bruto (con IVA) y base (sin IVA) de las líneas que no son descuento. */
export function brutoYBase(lineas: LineaCalculada[]): { bruto: Dec; base: Dec } {
    let bruto = CERO
    let base = CERO
    for (const l of lineas) {
        if (l.tipo === 'descuento') continue
        bruto = bruto.plus(l.total)
        base = base.plus(dec(l.total).minus(l.iva))
    }
    return { bruto, base }
}

/** Motivo activo del catálogo de la empresa por nombre (los sembrados). */
export async function motivoPorNombre(
    cliente: QueryClientContract,
    empresaId: number,
    nombre: string,
): Promise<number> {
    const fila = (await cliente
        .from('billing.motivos_sin_costo')
        .where({ empresa_id: empresaId, nombre })
        .select('id')
        .first()) as { id: number } | null
    if (!fila) {
        throw new ValidacionFallida([
            {
                field: 'motivo_id',
                message: `La empresa ${empresaId} no tiene el motivo «${nombre}» en su catálogo`,
                rule: 'motivo',
            },
        ])
    }
    return Number(fila.id)
}

/**
 * Registra la bonificación (idempotente por `clave_unica`: si ya existe, la devuelve con `creada:
 * false`) con su asiento interno y su evento. La llama quien tenía una factura en Q0 (emisión del
 * periodo, cargo único), dentro de su transacción y con el lock del cliente tomado.
 */
export async function registrarBonificacion(
    t: Transaccion,
    datos: DatosBonificacion,
): Promise<{ bonificacion: BonificacionVista; creada: boolean }> {
    const existente = (await t.trx
        .from('billing.bonificaciones')
        .where('clave_unica', datos.clave_unica)
        .select('id')
        .first()) as { id: number } | null
    if (existente) return { bonificacion: await verBonificacion(Number(existente.id), t.trx), creada: false }

    const { bruto, base } = brutoYBase(datos.lineas)
    const { id } = (await t.trx
        .rawQuery(`SELECT nextval(pg_get_serial_sequence('billing.bonificaciones', 'id'))::bigint AS id`)
        .then((r: { rows: Array<{ id: string }> }) => r.rows[0]!)) as { id: string }
    const bonificacionId = Number(id)
    const asiento = await new RegistrarAsiento().execute(
        {
            empresa_id: datos.empresa_id,
            fecha: hoyGuatemala(),
            descripcion: `Bonificación ${bonificacionId} · ${datos.concepto}`,
            origen_tipo: 'bonificacion',
            origen_id: bonificacionId,
            // total 0: sin CxC ni IVA, `5.1.01 / ingreso de cada línea` por la base
            movimientos: movimientosFactura(datos.cliente_id, datos.lineas, CERO, false),
        },
        t.ctx,
        { trx: t.trx },
    )
    const lineas = datos.lineas.map((l) => ({
        concepto: l.concepto,
        tipo: l.tipo,
        cantidad: l.cantidad,
        precio_unitario: l.precio_unitario,
        gravable: l.gravable,
        iva: l.iva,
        total: l.total,
        ...(l.cuenta_codigo ? { cuenta_codigo: l.cuenta_codigo } : {}),
    }))
    await t.trx.rawQuery(
        `INSERT INTO billing.bonificaciones
                (id, empresa_id, cliente_id, servicio_id, periodo, clave_unica, concepto, origen, bruto, base,
                 lineas, motivo_id, motivo_texto, canje_id, asiento_id, reglas_snapshot, creado_por)
         OVERRIDING SYSTEM VALUE VALUES (?, ?, ?, NULLIF(?, 0), ?, ?, ?, ?, ?, ?, ?::jsonb, ?, ?, NULLIF(?, 0), ?, ?::jsonb,
                 NULLIF(?, 0))`,
        [
            bonificacionId,
            datos.empresa_id,
            datos.cliente_id,
            datos.servicio_id ?? 0,
            datos.periodo,
            datos.clave_unica,
            datos.concepto,
            datos.origen,
            aTexto(bruto),
            aTexto(base),
            JSON.stringify(lineas),
            datos.motivo_id,
            datos.motivo_texto.trim(),
            datos.canje_id ?? 0,
            asiento.id,
            JSON.stringify(datos.reglas_snapshot ?? {}),
            usuarioDelActor(t.ctx.actor) ?? 0,
        ],
    )
    const vista = await verBonificacion(bonificacionId, t.trx)
    await t.registrarCambios({ tipo: 'bonificacion', id: bonificacionId }, null, {
        origen: vista.origen,
        clave_unica: vista.clave_unica,
        bruto: vista.bruto,
        base: vista.base,
        motivo_id: vista.motivo_id,
        motivo_texto: vista.motivo_texto,
        canje_id: vista.canje_id,
        asiento_id: vista.asiento_id,
    })
    await t.emit('bonificacion.registrada', {
        bonificacion_id: bonificacionId,
        empresa_id: datos.empresa_id,
        cliente_id: datos.cliente_id,
        servicio_id: datos.servicio_id,
        periodo: datos.periodo,
        origen: datos.origen,
        bruto: vista.bruto,
    })
    return { bonificacion: vista, creada: true }
}

const COLUMNAS = [
    'b.id',
    'b.empresa_id',
    'b.cliente_id',
    'b.servicio_id',
    db.raw(`to_char(b.periodo, 'YYYY-MM-DD') as periodo`),
    'b.clave_unica',
    'b.concepto',
    'b.origen',
    'b.bruto',
    'b.base',
    'b.lineas',
    'b.motivo_id',
    'm.nombre as motivo_nombre',
    'b.motivo_texto',
    'b.canje_id',
    'b.asiento_id',
    'b.created_at',
]

function aVista(f: Record<string, unknown>): BonificacionVista {
    const n = (v: unknown) => (v === null || v === undefined ? null : Number(v))
    return {
        ...(f as unknown as BonificacionVista),
        id: Number(f.id),
        empresa_id: Number(f.empresa_id),
        cliente_id: Number(f.cliente_id),
        servicio_id: n(f.servicio_id),
        motivo_id: Number(f.motivo_id),
        canje_id: n(f.canje_id),
        asiento_id: Number(f.asiento_id),
    }
}

export async function verBonificacion(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<BonificacionVista> {
    const fila = (await cliente
        .from('billing.bonificaciones as b')
        .join('billing.motivos_sin_costo as m', 'm.id', 'b.motivo_id')
        .where('b.id', id)
        .select(...COLUMNAS)
        .first()) as Record<string, unknown> | null
    if (!fila) throw new NoEncontrado(`La bonificación ${id} no existe`)
    return aVista(fila)
}

export interface FiltrosBonificaciones extends OpcionesPaginacion {
    cliente_id?: number
    servicio_id?: number
    origen?: OrigenBonificacion
    desde?: string
    hasta?: string
}

export async function listarBonificaciones(
    filtros: FiltrosBonificaciones,
    alcance: Alcance | undefined,
    empresas: number[] | null,
): Promise<Pagina<BonificacionVista>> {
    const consulta = db
        .from('billing.bonificaciones as b')
        .join('billing.motivos_sin_costo as m', 'm.id', 'b.motivo_id')
        .join('core.clientes as c', 'c.id', 'b.cliente_id')
        .leftJoin('core.servicios as s', 's.id', 'b.servicio_id')
        .if(empresas !== null, (q) => q.whereIn('b.empresa_id', empresas!))
        .if(filtros.cliente_id, (q) => q.where('b.cliente_id', filtros.cliente_id!))
        .if(filtros.servicio_id, (q) => q.where('b.servicio_id', filtros.servicio_id!))
        .if(filtros.origen, (q) => q.where('b.origen', filtros.origen!))
        .if(filtros.desde, (q) => q.where('b.periodo', '>=', filtros.desde!))
        .if(filtros.hasta, (q) => q.where('b.periodo', '<=', filtros.hasta!))
        .select(...COLUMNAS)
    filtrarPorAlcance(consulta, alcance, dimensionesFactura)
    const pagina = await paginar<Record<string, unknown>>(consulta, filtros, { columna: 'b.id' })
    return { data: pagina.data.map(aVista), nextCursor: pagina.nextCursor }
}

/** Dimensiones de alcance de una bonificación (para `exigirAlcance`), como las de una factura. */
export async function dimensionesDeBonificacion(id: number) {
    const fila = (await db
        .from('billing.bonificaciones as b')
        .join('core.clientes as c', 'c.id', 'b.cliente_id')
        .leftJoin('core.servicios as s', 's.id', 'b.servicio_id')
        .where('b.id', id)
        .select('c.zona_id', 's.router_id', 'b.empresa_id')
        .first()) as { zona_id: number | null; router_id: number | null; empresa_id: number } | null
    if (!fila) throw new NoEncontrado(`La bonificación ${id} no existe`)
    return { zona: [fila.zona_id], router: [fila.router_id], empresa_id: Number(fila.empresa_id) }
}
