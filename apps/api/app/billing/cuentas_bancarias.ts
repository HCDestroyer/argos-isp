import db from '@adonisjs/lucid/services/db'
import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { NoEncontrado } from '#shared/errores'

/**
 * Cuentas bancarias propias y catálogo de bancos de Guatemala (lectura). Es la **fuente única**
 * de las cuentas para depósito que muestran el panel y el portal. Las acciones están en
 * `actions/crear_cuenta_bancaria.ts` y `actions/editar_cuenta_bancaria.ts`.
 */

export type Moneda = 'GTQ' | 'USD'

export interface EntradaCuentaBancaria {
    /** empresa dueña de la cuenta (solo al crear); por defecto la activa */
    empresa_id?: number | null
    banco_id: number
    numero: string
    alias: string
    moneda?: Moneda
    activa?: boolean
}

export interface BancoVista {
    id: number
    nombre: string
    activo: boolean
}

export interface CuentaBancariaVista {
    id: number
    /** empresa (NIT) dueña de la cuenta: sus depósitos son pagos de esa empresa */
    empresa_id: number
    banco_id: number
    banco_nombre: string
    numero: string
    alias: string
    moneda: Moneda
    activa: boolean
    cuenta_id: number
    cuenta_codigo: string
    version: number
    created_at: Date
    updated_at: Date
}

export async function listarBancos(
    cliente: QueryClientContract = db.connection(),
    soloActivos = true,
): Promise<BancoVista[]> {
    return (await cliente
        .from('billing.bancos')
        .if(soloActivos, (q) => q.where('activo', true))
        .orderBy([
            { column: 'orden', order: 'asc' },
            { column: 'nombre', order: 'asc' },
        ])
        .select('id', 'nombre', 'activo')) as BancoVista[]
}

function consultaCuentas(cliente: QueryClientContract) {
    return cliente
        .from('billing.cuentas_bancarias as cb')
        .join('billing.bancos as b', 'b.id', 'cb.banco_id')
        .join('ledger.cuentas as c', 'c.id', 'cb.cuenta_id')
        .select(
            'cb.id',
            'cb.empresa_id',
            'cb.banco_id',
            'b.nombre as banco_nombre',
            'cb.numero',
            'cb.alias',
            'cb.moneda',
            'cb.activa',
            'cb.cuenta_id',
            'c.codigo as cuenta_codigo',
            'cb.version',
            'cb.created_at',
            'cb.updated_at',
        )
}

export async function listarCuentasBancarias(
    filtros: { activa?: boolean } = {},
    empresas: number[] | null = null,
) {
    return (await consultaCuentas(db.connection())
        .if(filtros.activa !== undefined, (q) => q.where('cb.activa', filtros.activa!))
        .if(empresas !== null, (q) => q.whereIn('cb.empresa_id', empresas!))
        .orderBy([
            { column: 'b.orden', order: 'asc' },
            { column: 'cb.alias', order: 'asc' },
            { column: 'cb.id', order: 'asc' },
        ])) as CuentaBancariaVista[]
}

/** Lo que el cliente ve en `/corte` para depositar (sin datos internos del libro). */
export interface CuentaDeposito {
    /** se envía como `cuenta_bancaria_id` al subir el comprobante (`RegistrarComprobante`) */
    id: number
    banco_nombre: string
    alias: string
    /** número completo, tal como se escribe en la boleta */
    numero: string
    moneda: 'GTQ'
}

/**
 * Cuentas para depósito del portal (A5), solo lectura: activas y en quetzales (una cuenta en USD
 * no recibe pagos: `POST /pagos` y los comprobantes la rechazan con 422 `moneda`). Mismo orden
 * que el panel (orden del banco, alias). El número va completo: el cliente lo necesita para
 * depositar, y es el dato que el ISP publica en sus avisos de cobro.
 *
 * Multiempresa: con `empresaId` solo las cuentas de esa empresa (la del servicio del cliente):
 * un depósito a la cuenta de otra empresa se rechaza (`cuenta_de_otra_empresa`).
 */
export async function listarCuentasDeposito(
    cliente: QueryClientContract = db.connection(),
    empresaId: number | null = null,
): Promise<CuentaDeposito[]> {
    return (await cliente
        .from('billing.cuentas_bancarias as cb')
        .join('billing.bancos as b', 'b.id', 'cb.banco_id')
        .where('cb.activa', true)
        .where('cb.moneda', 'GTQ')
        .if(empresaId !== null, (q) => q.where('cb.empresa_id', empresaId!))
        .orderBy([
            { column: 'b.orden', order: 'asc' },
            { column: 'cb.alias', order: 'asc' },
            { column: 'cb.id', order: 'asc' },
        ])
        .select(
            'cb.id',
            'b.nombre as banco_nombre',
            'cb.alias',
            'cb.numero',
            'cb.moneda',
        )) as CuentaDeposito[]
}

export async function verCuentaBancaria(
    id: number,
    cliente: QueryClientContract = db.connection(),
): Promise<CuentaBancariaVista> {
    const fila = (await consultaCuentas(cliente).where('cb.id', id).first()) as CuentaBancariaVista | null
    if (!fila) throw new NoEncontrado(`La cuenta bancaria ${id} no existe`)
    return fila
}

/** Nombre de la subcuenta del libro: "Banrural · Recaudación (****4321)". */
export function nombreCuentaLibro(banco: string, alias: string, numero: string): string {
    const ultimos = numero.replace(/\s+/g, '').slice(-4)
    return `${banco} · ${alias} (****${ultimos})`
}
