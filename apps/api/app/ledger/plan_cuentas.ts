import type { QueryClientContract } from '@adonisjs/lucid/types/database'
import { ReglaNegocio } from '#shared/errores'

/**
 * Plan de cuentas base de ArgosIsp.
 *
 * Las demás piezas del módulo se refieren a las cuentas por su **código** (constante `CUENTAS`),
 * nunca por id: los ids cambian entre ambientes, los códigos no.
 *
 *  - `imputable: false` → cuenta de agrupación; no recibe movimientos (lo impide un trigger).
 *  - `auxiliar_cliente: true` → cada movimiento lleva `cliente_id` (CxC y Anticipos).
 *  - Cada caja y cada banco tiene su propia cuenta hija de `1.1.01 Cajas` / `1.1.02 Bancos`.
 */

export type TipoCuenta = 'activo' | 'pasivo' | 'ingreso' | 'gasto'

export interface DefinicionCuenta {
    codigo: string
    nombre: string
    tipo: TipoCuenta
    padre: string | null
    imputable: boolean
    auxiliar_cliente?: boolean
}

export const CUENTAS = {
    CAJAS: '1.1.01',
    CAJA_PRINCIPAL: '1.1.01.01',
    BANCOS: '1.1.02',
    BANCO_PRINCIPAL: '1.1.02.01',
    CXC_CLIENTES: '1.1.03',
    ANTICIPOS_CLIENTES: '2.1.01',
    IVA_DEBITO: '2.1.02',
    TRANSITORIAS: '2.9',
    SALDOS_APERTURA: '2.9.01',
    INGRESOS_INTERNET: '4.1.01',
    RECARGOS_MORA: '4.1.02',
    OTROS_INGRESOS: '4.1.03',
    SOBRANTES_CAJA: '4.1.04',
    DESCUENTOS: '5.1.01',
    COMISIONES_PASARELAS: '5.1.02',
    GASTO_ENERGIA: '5.2.01',
    GASTO_TRANSITO: '5.2.02',
    GASTO_NOMINA: '5.2.03',
    GASTO_VEHICULOS: '5.2.04',
    GASTO_ALQUILERES: '5.2.05',
    FALTANTES_CAJA: '5.2.06',
    GASTO_OTROS: '5.2.99',
} as const

export type CodigoCuenta = (typeof CUENTAS)[keyof typeof CUENTAS]

/** En orden: cada padre aparece antes que sus hijas. */
export const PLAN_CUENTAS: readonly DefinicionCuenta[] = [
    { codigo: '1', nombre: 'Activo', tipo: 'activo', padre: null, imputable: false },
    { codigo: '1.1', nombre: 'Activo corriente', tipo: 'activo', padre: '1', imputable: false },
    { codigo: CUENTAS.CAJAS, nombre: 'Cajas', tipo: 'activo', padre: '1.1', imputable: false },
    {
        codigo: CUENTAS.CAJA_PRINCIPAL,
        nombre: 'Caja principal',
        tipo: 'activo',
        padre: CUENTAS.CAJAS,
        imputable: true,
    },
    { codigo: CUENTAS.BANCOS, nombre: 'Bancos', tipo: 'activo', padre: '1.1', imputable: false },
    {
        codigo: CUENTAS.BANCO_PRINCIPAL,
        nombre: 'Banco principal',
        tipo: 'activo',
        padre: CUENTAS.BANCOS,
        imputable: true,
    },
    {
        codigo: CUENTAS.CXC_CLIENTES,
        nombre: 'Cuentas por cobrar clientes',
        tipo: 'activo',
        padre: '1.1',
        imputable: true,
        auxiliar_cliente: true,
    },

    { codigo: '2', nombre: 'Pasivo', tipo: 'pasivo', padre: null, imputable: false },
    { codigo: '2.1', nombre: 'Pasivo corriente', tipo: 'pasivo', padre: '2', imputable: false },
    {
        codigo: CUENTAS.ANTICIPOS_CLIENTES,
        nombre: 'Anticipos de clientes',
        tipo: 'pasivo',
        padre: '2.1',
        imputable: true,
        auxiliar_cliente: true,
    },
    {
        codigo: CUENTAS.IVA_DEBITO,
        nombre: 'IVA débito fiscal',
        tipo: 'pasivo',
        padre: '2.1',
        imputable: true,
    },
    {
        codigo: CUENTAS.TRANSITORIAS,
        nombre: 'Cuentas transitorias',
        tipo: 'pasivo',
        padre: '2',
        imputable: false,
    },
    {
        codigo: CUENTAS.SALDOS_APERTURA,
        nombre: 'Saldos de apertura por importación',
        tipo: 'pasivo',
        padre: CUENTAS.TRANSITORIAS,
        imputable: true,
    },

    { codigo: '4', nombre: 'Ingresos', tipo: 'ingreso', padre: null, imputable: false },
    { codigo: '4.1', nombre: 'Ingresos de operación', tipo: 'ingreso', padre: '4', imputable: false },
    {
        codigo: CUENTAS.INGRESOS_INTERNET,
        nombre: 'Ingresos por servicios de internet',
        tipo: 'ingreso',
        padre: '4.1',
        imputable: true,
    },
    {
        codigo: CUENTAS.RECARGOS_MORA,
        nombre: 'Recargos por mora',
        tipo: 'ingreso',
        padre: '4.1',
        imputable: true,
    },
    {
        codigo: CUENTAS.OTROS_INGRESOS,
        nombre: 'Otros ingresos',
        tipo: 'ingreso',
        padre: '4.1',
        imputable: true,
    },
    {
        codigo: CUENTAS.SOBRANTES_CAJA,
        nombre: 'Sobrantes de caja',
        tipo: 'ingreso',
        padre: '4.1',
        imputable: true,
    },

    { codigo: '5', nombre: 'Gastos', tipo: 'gasto', padre: null, imputable: false },
    { codigo: '5.1', nombre: 'Gastos de ventas', tipo: 'gasto', padre: '5', imputable: false },
    { codigo: CUENTAS.DESCUENTOS, nombre: 'Descuentos', tipo: 'gasto', padre: '5.1', imputable: true },
    {
        codigo: CUENTAS.COMISIONES_PASARELAS,
        nombre: 'Comisiones de pasarelas',
        tipo: 'gasto',
        padre: '5.1',
        imputable: true,
    },
    { codigo: '5.2', nombre: 'Gastos de operación', tipo: 'gasto', padre: '5', imputable: false },
    {
        codigo: CUENTAS.GASTO_ENERGIA,
        nombre: 'Energía eléctrica',
        tipo: 'gasto',
        padre: '5.2',
        imputable: true,
    },
    {
        codigo: CUENTAS.GASTO_TRANSITO,
        nombre: 'Tránsito de internet',
        tipo: 'gasto',
        padre: '5.2',
        imputable: true,
    },
    { codigo: CUENTAS.GASTO_NOMINA, nombre: 'Nómina', tipo: 'gasto', padre: '5.2', imputable: true },
    { codigo: CUENTAS.GASTO_VEHICULOS, nombre: 'Vehículos', tipo: 'gasto', padre: '5.2', imputable: true },
    { codigo: CUENTAS.GASTO_ALQUILERES, nombre: 'Alquileres', tipo: 'gasto', padre: '5.2', imputable: true },
    {
        codigo: CUENTAS.FALTANTES_CAJA,
        nombre: 'Faltantes de caja',
        tipo: 'gasto',
        padre: '5.2',
        imputable: true,
    },
    { codigo: CUENTAS.GASTO_OTROS, nombre: 'Otros gastos', tipo: 'gasto', padre: '5.2', imputable: true },
]

/** Categorías de egreso y la cuenta de gasto a la que van. */
export const CATEGORIAS_EGRESO = [
    { clave: 'energia', nombre: 'Energía', cuenta: CUENTAS.GASTO_ENERGIA },
    { clave: 'transito', nombre: 'Tránsito', cuenta: CUENTAS.GASTO_TRANSITO },
    { clave: 'nomina', nombre: 'Nómina', cuenta: CUENTAS.GASTO_NOMINA },
    { clave: 'vehiculos', nombre: 'Vehículos', cuenta: CUENTAS.GASTO_VEHICULOS },
    { clave: 'alquileres', nombre: 'Alquileres', cuenta: CUENTAS.GASTO_ALQUILERES },
    { clave: 'otros', nombre: 'Otros', cuenta: CUENTAS.GASTO_OTROS },
] as const satisfies ReadonlyArray<{ clave: string; nombre: string; cuenta: CodigoCuenta }>

export type ClaveCategoriaEgreso = (typeof CATEGORIAS_EGRESO)[number]['clave']
export const CLAVES_CATEGORIA_EGRESO = CATEGORIAS_EGRESO.map((c) => c.clave)

/** Caja y banco iniciales (cada uno con su cuenta del plan). */
export const CAJA_INICIAL = { nombre: 'Caja principal', cuenta: CUENTAS.CAJA_PRINCIPAL } as const
export const BANCO_INICIAL = { nombre: 'Banco principal', cuenta: CUENTAS.BANCO_PRINCIPAL } as const

/**
 * Siembra el plan de cuentas, las categorías de egreso, la caja y el banco iniciales.
 * Idempotente: lo que ya existe (por código o nombre) no se toca.
 */
export async function sembrarPlanCuentas(cliente: QueryClientContract): Promise<void> {
    const ids = new Map<string, number>()
    const cargarIds = async () => {
        const filas = (await cliente.from('ledger.cuentas').select('id', 'codigo')) as Array<{
            id: number
            codigo: string
        }>
        for (const fila of filas) ids.set(fila.codigo, fila.id)
    }
    await cargarIds()

    for (const cuenta of PLAN_CUENTAS) {
        if (ids.has(cuenta.codigo)) continue
        const [fila] = (await cliente
            .insertQuery()
            .table('ledger.cuentas')
            .insert({
                codigo: cuenta.codigo,
                nombre: cuenta.nombre,
                tipo: cuenta.tipo,
                padre_id: cuenta.padre ? ids.get(cuenta.padre)! : null,
                imputable: cuenta.imputable,
                auxiliar_cliente: cuenta.auxiliar_cliente ?? false,
            })
            .returning('id')) as Array<{ id: number }>
        ids.set(cuenta.codigo, fila!.id)
    }

    for (const categoria of CATEGORIAS_EGRESO) {
        await cliente
            .knexQuery()
            .table('ledger.egresos_categorias')
            .insert({
                clave: categoria.clave,
                nombre: categoria.nombre,
                cuenta_id: ids.get(categoria.cuenta)!,
            })
            .onConflict('nombre')
            .ignore()
    }

    const caja = await cliente.from('ledger.cajas').where('cuenta_id', ids.get(CAJA_INICIAL.cuenta)!).first()
    if (!caja) {
        await cliente
            .knexQuery()
            .table('ledger.cajas')
            .insert({ nombre: CAJA_INICIAL.nombre, cuenta_id: ids.get(CAJA_INICIAL.cuenta)! })
            .onConflict('nombre')
            .ignore()
    }

    const banco = await cliente
        .from('ledger.bancos')
        .where('cuenta_id', ids.get(BANCO_INICIAL.cuenta)!)
        .first()
    if (!banco) {
        await cliente
            .insertQuery()
            .table('ledger.bancos')
            .insert({ nombre: BANCO_INICIAL.nombre, cuenta_id: ids.get(BANCO_INICIAL.cuenta)! })
    }
}

export interface CuentaResuelta {
    id: number
    codigo: string
    nombre: string
    tipo: TipoCuenta
    imputable: boolean
    auxiliar_cliente: boolean
    activa: boolean
}

/**
 * Resuelve códigos del plan a sus filas. Lanza 422 si falta alguno (plan sin sembrar).
 */
export async function cuentasPorCodigo(
    cliente: QueryClientContract,
    codigos: readonly string[],
): Promise<Map<string, CuentaResuelta>> {
    const unicos = [...new Set(codigos)]
    const filas = (await cliente
        .from('ledger.cuentas')
        .whereIn('codigo', unicos)
        .select(
            'id',
            'codigo',
            'nombre',
            'tipo',
            'imputable',
            'auxiliar_cliente',
            'activa',
        )) as CuentaResuelta[]
    const mapa = new Map(filas.map((fila) => [fila.codigo, fila]))
    const faltantes = unicos.filter((codigo) => !mapa.has(codigo))
    if (faltantes.length > 0) {
        throw new ReglaNegocio(
            `Cuentas inexistentes en el plan: ${faltantes.join(', ')}`,
            'cuenta_inexistente',
        )
    }
    return mapa
}
