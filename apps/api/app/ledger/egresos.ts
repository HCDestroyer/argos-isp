import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { filtrarPorAlcance, type Alcance } from '#core/acl'
import { NoEncontrado } from '#shared/errores'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import type { ClaveCategoriaEgreso } from '#ledger/plan_cuentas'

/**
 * Egresos: lectura (lista, detalle, categorías). Las acciones (`registrarEgreso`, `anularEgreso`)
 * viven en `actions/`. Un egreso es inmutable: anularlo agrega una fila en
 * `ledger.egresos_anulaciones` con su asiento de reverso.
 */

export const METODOS_EGRESO = ['caja', 'banco', 'cuenta_bancaria'] as const
export type MetodoEgreso = (typeof METODOS_EGRESO)[number]
export type EstadoEgreso = 'registrado' | 'anulado'

export interface EgresoVista {
    id: number
    fecha: string
    categoria: ClaveCategoriaEgreso
    categoria_nombre: string
    cuenta_codigo: string
    proveedor: string | null
    descripcion: string | null
    comprobante: string | null
    monto: string
    metodo: MetodoEgreso
    caja_id: number | null
    caja_nombre: string | null
    turno_id: number | null
    banco_id: number | null
    banco_nombre: string | null
    cuenta_bancaria_id: number | null
    cuenta_bancaria_nombre: string | null
    asiento_id: number | null
    estado: EstadoEgreso
    registrado_por: number | null
    registrado_por_nombre: string | null
    anulado_en: Date | null
    anulado_por: number | null
    motivo_anulacion: string | null
    asiento_reverso_id: number | null
    version: number
    created_at: Date
    updated_at: Date
}

function consultaEgresos(cliente: QueryClientContract) {
    return (
        cliente
            .from('ledger.egresos as e')
            .join('ledger.egresos_categorias as ec', 'ec.id', 'e.categoria_id')
            .join('ledger.cuentas as cu', 'cu.id', 'ec.cuenta_id')
            .leftJoin('ledger.cajas as cj', 'cj.id', 'e.caja_id')
            .leftJoin('ledger.bancos as bl', 'bl.id', 'e.banco_id')
            .leftJoin('billing.cuentas_bancarias as cb', 'cb.id', 'e.cuenta_bancaria_id')
            .leftJoin('billing.bancos as bd', 'bd.id', 'cb.banco_id')
            .leftJoin('ledger.egresos_anulaciones as an', 'an.egreso_id', 'e.id')
            // el egreso es inmutable: su asiento se encuentra por origen (no por `egresos.asiento_id`)
            .leftJoin('ledger.asientos as ae', (j) =>
                j
                    .on('ae.origen_id', 'e.id')
                    .andOnVal('ae.origen_tipo', '=', 'egreso')
                    .andOnNull('ae.reversa_de'),
            )
            .leftJoin('core.usuarios as ur', 'ur.id', 'e.registrado_por')
            .select(
                'e.id',
                cliente.raw(`to_char(e.fecha, 'YYYY-MM-DD') as fecha`),
                'ec.clave as categoria',
                'ec.nombre as categoria_nombre',
                'cu.codigo as cuenta_codigo',
                'e.proveedor',
                'e.descripcion',
                'e.comprobante',
                'e.monto',
                'e.metodo',
                'e.caja_id',
                'cj.nombre as caja_nombre',
                'e.turno_id',
                'e.banco_id',
                'bl.nombre as banco_nombre',
                'e.cuenta_bancaria_id',
                cliente.raw(
                    "case when cb.id is null then null else bd.nombre || ' · ' || cb.alias end as cuenta_bancaria_nombre",
                ),
                'ae.id as asiento_id',
                cliente.raw(`case when an.id is null then 'registrado' else 'anulado' end as estado`),
                'e.registrado_por',
                'ur.nombre as registrado_por_nombre',
                'an.anulado_en',
                'an.anulado_por',
                'an.motivo as motivo_anulacion',
                'an.asiento_id as asiento_reverso_id',
                'e.version',
                'e.created_at',
                'e.updated_at',
            )
    )
}

export async function verEgreso(id: number, cliente: QueryClientContract = db.connection()) {
    const fila = (await consultaEgresos(cliente).where('e.id', id).first()) as EgresoVista | null
    if (!fila) throw new NoEncontrado(`El egreso ${id} no existe`)
    return fila
}

export interface FiltrosEgresos extends OpcionesPaginacion {
    desde?: string
    hasta?: string
    categoria?: ClaveCategoriaEgreso
    metodo?: MetodoEgreso
    estado?: EstadoEgreso
    caja_id?: number
    cuenta_bancaria_id?: number
}

/** Un usuario con alcance por caja solo ve los egresos en efectivo de su caja. */
export async function listarEgresos(filtros: FiltrosEgresos, alcance?: Alcance) {
    const consulta = consultaEgresos(db.connection())
        .if(filtros.desde, (q) => q.where('e.fecha', '>=', filtros.desde!))
        .if(filtros.hasta, (q) => q.where('e.fecha', '<=', filtros.hasta!))
        .if(filtros.categoria, (q) => q.where('ec.clave', filtros.categoria!))
        .if(filtros.metodo, (q) => q.where('e.metodo', filtros.metodo!))
        .if(filtros.caja_id, (q) => q.where('e.caja_id', filtros.caja_id!))
        .if(filtros.cuenta_bancaria_id, (q) => q.where('e.cuenta_bancaria_id', filtros.cuenta_bancaria_id!))
        .if(filtros.estado === 'anulado', (q) => q.whereNotNull('an.id'))
        .if(filtros.estado === 'registrado', (q) => q.whereNull('an.id'))
    filtrarPorAlcance(consulta, alcance, { caja: (q, ids) => q.whereIn('e.caja_id', ids) })
    return paginar<EgresoVista>(consulta, filtros, { columna: 'e.id' })
}

export async function dimensionesDeEgreso(id: number) {
    const fila = await db.from('ledger.egresos').where('id', id).select('caja_id').first()
    if (!fila) throw new NoEncontrado(`El egreso ${id} no existe`)
    return { caja: [fila.caja_id as number | null] }
}

export async function listarCategoriasEgreso() {
    return db
        .from('ledger.egresos_categorias as ec')
        .join('ledger.cuentas as cu', 'cu.id', 'ec.cuenta_id')
        .orderBy('ec.id', 'asc')
        .select(
            'ec.id',
            'ec.clave',
            'ec.nombre',
            'cu.id as cuenta_id',
            'cu.codigo as cuenta_codigo',
            'cu.nombre as cuenta_nombre',
        )
}

/** Efectivo que salió de un turno de caja (egresos vigentes); baja el esperado del cierre. */
export async function egresosDelTurno(cliente: QueryClientContract, turnoId: number): Promise<string> {
    const fila = (await cliente
        .from('ledger.egresos as e')
        .where('e.turno_id', turnoId)
        .whereNotExists((q) => q.from('ledger.egresos_anulaciones as an').whereRaw('an.egreso_id = e.id'))
        .select(cliente.raw('coalesce(sum(e.monto), 0)::text as total'))
        .first()) as { total: string }
    return fila.total
}
