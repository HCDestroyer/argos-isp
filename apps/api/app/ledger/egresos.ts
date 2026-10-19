import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { filtrarPorAlcance, type Alcance } from '#core/acl'
import { filtrarPorEmpresa } from '#shared/empresa_activa'
import { NoEncontrado, ReglaNegocio, ValidacionFallida } from '#shared/errores'
import type { ContextoAccion } from '#shared/contexto'
import { resolverEmpresaActiva } from '#core/empresas'
import { paginar, type OpcionesPaginacion } from '#shared/paginacion'
import { CLAVES_CATEGORIA_EGRESO, CUENTAS, type ClaveCategoriaEgreso } from '#ledger/plan_cuentas'

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
    /** empresa (NIT) que paga el egreso */
    empresa_id: number
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
    /** compra al contado que paga este egreso (su asiento es el de la compra; se anula con la compra) */
    compra_id: number | null
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
            // el egreso es inmutable: su asiento se encuentra por origen (no por `egresos.asiento_id`);
            // el de una compra al contado es el de la compra (fase 5, §3.4)
            .joinRaw(
                `LEFT JOIN ledger.asientos ae ON ae.reversa_de IS NULL
                   AND ((ae.origen_tipo = 'egreso' AND ae.origen_id = e.id)
                     OR (ae.origen_tipo = 'compra' AND ae.origen_id = e.compra_id))`,
            )
            .leftJoin('core.usuarios as ur', 'ur.id', 'e.registrado_por')
            .select(
                'e.id',
                'e.empresa_id',
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
                'e.compra_id',
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
export async function listarEgresos(
    filtros: FiltrosEgresos,
    alcance?: Alcance,
    empresas: number[] | null = null,
) {
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
    filtrarPorEmpresa(consulta, empresas, (q, ids) => q.whereIn('e.empresa_id', ids))
    return paginar<EgresoVista>(consulta, filtros, { columna: 'e.id' })
}

export async function dimensionesDeEgreso(id: number) {
    const fila = await db.from('ledger.egresos').where('id', id).select('caja_id', 'empresa_id').first()
    if (!fila) throw new NoEncontrado(`El egreso ${id} no existe`)
    return { caja: [fila.caja_id as number | null], empresa_id: Number(fila.empresa_id) }
}

export async function listarCategoriasEgreso() {
    return (
        db
            .from('ledger.egresos_categorias as ec')
            .join('ledger.cuentas as cu', 'cu.id', 'ec.cuenta_id')
            // las internas (p. ej. `premios`, entrega de premios de sorteo) no se eligen en POST /egresos
            .whereIn('ec.clave', [...CLAVES_CATEGORIA_EGRESO])
            .orderBy('ec.id', 'asc')
            .select(
                'ec.id',
                'ec.clave',
                'ec.nombre',
                'cu.id as cuenta_id',
                'cu.codigo as cuenta_codigo',
                'cu.nombre as cuenta_nombre',
            )
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

/** De dónde sale el dinero de un egreso (o de una compra al contado, fase 5). */
export interface PedidoOrigenEgreso {
    metodo: MetodoEgreso
    caja_id?: number | null
    banco_id?: number | null
    cuenta_bancaria_id?: number | null
}

export interface OrigenEgreso {
    empresa_id: number
    caja_id: number | null
    turno_id: number | null
    banco_id: number | null
    cuenta_bancaria_id: number | null
    /** cuenta del libro de la que sale el dinero */
    cuenta_id: number
    nombre: string
}

/**
 * Caja (con su turno abierto, si hay), banco del libro (por defecto el principal de la empresa
 * activa) o cuenta bancaria propia activa en GTQ. Lo usan `egresos.registrar` y las compras al
 * contado.
 */
export async function resolverOrigenEgreso(
    trx: QueryClientContract,
    ctx: ContextoAccion,
    input: PedidoOrigenEgreso,
): Promise<OrigenEgreso> {
    const vacio = { caja_id: null, turno_id: null, banco_id: null, cuenta_bancaria_id: null }
    if (input.metodo === 'caja') {
        const caja = (await trx
            .from('ledger.cajas')
            .where('id', input.caja_id!)
            .select('id', 'empresa_id', 'nombre', 'cuenta_id', 'activa')
            .first()) as {
            id: number
            empresa_id: number
            nombre: string
            cuenta_id: number
            activa: boolean
        } | null
        if (!caja || !caja.activa) {
            throw new ValidacionFallida([
                {
                    field: 'caja_id',
                    message: `La caja ${input.caja_id} no existe o está inactiva`,
                    rule: 'caja',
                },
            ])
        }
        // FOR SHARE como los cobros: si el turno se está cerrando, este egreso espera.
        const turno = await trx
            .from('ledger.cajas_turnos')
            .where('caja_id', caja.id)
            .whereNull('cerrado_en')
            .forShare()
            .select('id')
            .first()
        return {
            ...vacio,
            empresa_id: Number(caja.empresa_id),
            caja_id: caja.id,
            turno_id: (turno?.id as number | undefined) ?? null,
            cuenta_id: caja.cuenta_id,
            nombre: caja.nombre,
        }
    }
    if (input.metodo === 'banco') {
        // sin banco_id: el banco principal de la empresa activa
        const empresaActiva = input.banco_id ? null : await resolverEmpresaActiva(ctx, trx)
        const banco = (await trx
            .from('ledger.bancos as b')
            .join('ledger.cuentas as cu', 'cu.id', 'b.cuenta_id')
            .if(
                input.banco_id,
                (q) => q.where('b.id', input.banco_id!),
                (q) => q.where('cu.codigo', CUENTAS.BANCO_PRINCIPAL).where('b.empresa_id', empresaActiva!),
            )
            .select('b.id', 'b.empresa_id', 'b.nombre', 'b.cuenta_id')
            .first()) as { id: number; empresa_id: number; nombre: string; cuenta_id: number } | null
        if (!banco) {
            throw new ValidacionFallida([
                {
                    field: 'banco_id',
                    message: input.banco_id
                        ? `El banco ${input.banco_id} no existe`
                        : `La empresa ${empresaActiva} no tiene banco principal en el libro: indica banco_id o usa una cuenta bancaria`,
                    rule: 'exists',
                },
            ])
        }
        return {
            ...vacio,
            empresa_id: Number(banco.empresa_id),
            banco_id: banco.id,
            cuenta_id: banco.cuenta_id,
            nombre: banco.nombre,
        }
    }
    const cuenta = (await trx
        .from('billing.cuentas_bancarias as cb')
        .join('billing.bancos as b', 'b.id', 'cb.banco_id')
        .where('cb.id', input.cuenta_bancaria_id!)
        .select(
            'cb.id',
            'cb.empresa_id',
            'cb.alias',
            'cb.cuenta_id',
            'cb.activa',
            'cb.moneda',
            'b.nombre as banco',
        )
        .first()) as {
        id: number
        empresa_id: number
        alias: string
        cuenta_id: number
        activa: boolean
        moneda: string
        banco: string
    } | null
    if (!cuenta) {
        throw new ValidacionFallida([
            {
                field: 'cuenta_bancaria_id',
                message: `La cuenta bancaria ${input.cuenta_bancaria_id} no existe`,
                rule: 'exists',
            },
        ])
    }
    if (!cuenta.activa || cuenta.moneda !== 'GTQ') {
        throw new ReglaNegocio(
            `La cuenta bancaria ${cuenta.id} está inactiva o no es en quetzales`,
            'cuenta_bancaria_no_disponible',
        )
    }
    return {
        ...vacio,
        empresa_id: Number(cuenta.empresa_id),
        cuenta_bancaria_id: cuenta.id,
        cuenta_id: cuenta.cuenta_id,
        nombre: `${cuenta.banco} · ${cuenta.alias}`,
    }
}
