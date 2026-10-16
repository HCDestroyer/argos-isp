import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'
import { paginar, decodificarCursor, type OpcionesPaginacion, type Pagina } from '#shared/paginacion'
import { CUENTAS } from '#ledger/plan_cuentas'
import { CERO, aTexto, dec, type Dec } from '#ledger/dinero'

/**
 * Consultas de solo lectura del libro (plan de cuentas, diario, mayor, saldos).
 */

const COLUMNAS_CUENTA = [
    'id',
    'codigo',
    'nombre',
    'tipo',
    'padre_id',
    'imputable',
    'auxiliar_cliente',
    'activa',
    'version',
    'created_at',
    'updated_at',
] as const

export async function listarCuentas() {
    return db
        .from('ledger.cuentas')
        .select(...COLUMNAS_CUENTA)
        .orderBy('codigo', 'asc')
}

/*
|--------------------------------------------------------------------------
| Libro diario
|--------------------------------------------------------------------------
*/

export interface FiltrosDiario extends OpcionesPaginacion {
    desde?: string
    hasta?: string
    origen_tipo?: string
    origen_id?: number
}

interface FilaAsiento {
    id: number
    fecha: string
    descripcion: string
    origen_tipo: string
    origen_id: number | null
    reversa_de: number | null
    created_by: number | null
    created_at: Date
}

export async function libroDiario(filtros: FiltrosDiario) {
    const consulta = db
        .from('ledger.asientos')
        .select(
            'id',
            db.raw(`to_char(fecha, 'YYYY-MM-DD') as fecha`),
            'descripcion',
            'origen_tipo',
            'origen_id',
            'reversa_de',
            'created_by',
            'created_at',
        )
        .if(filtros.desde, (q) => q.where('fecha', '>=', filtros.desde!))
        .if(filtros.hasta, (q) => q.where('fecha', '<=', filtros.hasta!))
        .if(filtros.origen_tipo, (q) => q.where('origen_tipo', filtros.origen_tipo!))
        .if(filtros.origen_id, (q) => q.where('origen_id', filtros.origen_id!))

    const pagina = await paginar<FilaAsiento>(consulta, filtros)
    const movimientos = await movimientosDeAsientos(
        db.connection(),
        pagina.data.map((a) => a.id),
    )
    return {
        data: pagina.data.map((asiento) => ({ ...asiento, movimientos: movimientos.get(asiento.id) ?? [] })),
        nextCursor: pagina.nextCursor,
    }
}

export async function movimientosDeAsientos(cliente: QueryClientContract, asientos: number[]) {
    const mapa = new Map<number, Array<Record<string, unknown>>>()
    if (asientos.length === 0) return mapa
    const filas = (await cliente
        .from('ledger.movimientos as m')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .leftJoin('core.clientes as cl', 'cl.id', 'm.cliente_id')
        .whereIn('m.asiento_id', asientos)
        .orderBy('m.id', 'asc')
        .select(
            'm.id',
            'm.asiento_id',
            'm.cuenta_id',
            'c.codigo as cuenta_codigo',
            'c.nombre as cuenta_nombre',
            'm.debe',
            'm.haber',
            'm.cliente_id',
            'cl.nombre as cliente_nombre',
        )) as Array<{ asiento_id: number } & Record<string, unknown>>
    for (const { asiento_id: asientoId, ...movimiento } of filas) {
        const lista = mapa.get(asientoId) ?? []
        lista.push(movimiento)
        mapa.set(asientoId, lista)
    }
    return mapa
}

/*
|--------------------------------------------------------------------------
| Libro mayor
|--------------------------------------------------------------------------
*/

export interface FiltrosMayor extends OpcionesPaginacion {
    cuenta_id: number
    cliente_id?: number
    desde?: string
    hasta?: string
}

interface FilaMayor {
    movimiento_id: number
    asiento_id: number
    fecha: string
    descripcion: string
    debe: string
    haber: string
    cliente_id: number | null
}

/** Saldo según la naturaleza de la cuenta: deudora (activo, gasto) o acreedora (pasivo, ingreso). */
export function saldoSegunNaturaleza(tipo: string, debe: Dec, haber: Dec): Dec {
    return tipo === 'activo' || tipo === 'gasto' ? debe.minus(haber) : haber.minus(debe)
}

/**
 * Mayor de una cuenta (o auxiliar de un cliente), en orden de registro. Cada línea lleva el saldo
 * acumulado; `saldo_inicial` es lo anterior a `desde` y `saldo_final` el saldo hasta `hasta`.
 */
export async function libroMayor(filtros: FiltrosMayor) {
    const cuenta = (await db
        .from('ledger.cuentas')
        .where('id', filtros.cuenta_id)
        .select(...COLUMNAS_CUENTA)
        .first()) as ({ tipo: string } & Record<string, unknown>) | null
    if (!cuenta) throw new NoEncontrado(`La cuenta ${filtros.cuenta_id} no existe`)

    const base = () =>
        db
            .from('ledger.movimientos as m')
            .join('ledger.asientos as a', 'a.id', 'm.asiento_id')
            .where('m.cuenta_id', filtros.cuenta_id)
            .if(filtros.cliente_id, (q) => q.where('m.cliente_id', filtros.cliente_id!))
            .if(filtros.hasta, (q) => q.where('a.fecha', '<=', filtros.hasta!))

    const sumas = async (consulta: ReturnType<typeof base>): Promise<Dec> => {
        const fila = (await consulta
            .select(
                db.raw('coalesce(sum(m.debe), 0)::text as debe'),
                db.raw('coalesce(sum(m.haber), 0)::text as haber'),
            )
            .first()) as { debe: string; haber: string }
        return saldoSegunNaturaleza(cuenta.tipo, dec(fila.debe), dec(fila.haber))
    }

    const saldoInicial = filtros.desde ? await sumas(base().where('a.fecha', '<', filtros.desde)) : CERO
    const saldoFinal = await sumas(base())

    const enRango = () => base().if(filtros.desde, (q) => q.where('a.fecha', '>=', filtros.desde!))
    let acumulado = saldoInicial
    if (filtros.cursor) {
        acumulado = acumulado.plus(
            await sumas(enRango().where('m.id', '<=', Number(decodificarCursor(filtros.cursor)))),
        )
    }

    const pagina: Pagina<FilaMayor> = await paginar<FilaMayor>(
        enRango().select(
            'm.id as movimiento_id',
            'm.asiento_id',
            db.raw(`to_char(a.fecha, 'YYYY-MM-DD') as fecha`),
            'a.descripcion',
            'm.debe',
            'm.haber',
            'm.cliente_id',
        ),
        filtros,
        { columna: 'm.id', direccion: 'asc', clave: (fila) => fila.movimiento_id },
    )

    const data = pagina.data.map((fila) => {
        acumulado = acumulado.plus(saldoSegunNaturaleza(cuenta.tipo, dec(fila.debe), dec(fila.haber)))
        return { ...fila, saldo: aTexto(acumulado) }
    })

    return {
        cuenta,
        saldo_inicial: aTexto(saldoInicial),
        saldo_final: aTexto(saldoFinal),
        data,
        nextCursor: pagina.nextCursor,
    }
}

/*
|--------------------------------------------------------------------------
| Saldos
|--------------------------------------------------------------------------
*/

/**
 * Saldo del cliente = suma de sus movimientos en CxC (debe − haber). Positivo = nos debe.
 * Nunca una columna.
 */
export async function saldoCliente(
    clienteId: number,
    cliente: QueryClientContract = db.connection(),
): Promise<Dec> {
    const fila = (await cliente
        .from('ledger.movimientos as m')
        .join('ledger.cuentas as c', 'c.id', 'm.cuenta_id')
        .where('c.codigo', CUENTAS.CXC_CLIENTES)
        .where('m.cliente_id', clienteId)
        .select(
            cliente.raw('coalesce(sum(m.debe), 0)::text as debe'),
            cliente.raw('coalesce(sum(m.haber), 0)::text as haber'),
        )
        .first()) as { debe: string; haber: string }
    return dec(fila.debe).minus(dec(fila.haber))
}
