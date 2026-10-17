import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'
import type { RutasFixture } from '~/utils/fetchFixtures'
import { bd } from '../bd'
import { conPermiso, datosInvalidos, empresasDeLista } from '../comun'
import { HOY_FIXTURES } from '../facturacion/datos'

type Linea = Schema<'BalanceSaldos'>['total']['cuentas'][number]
type Tipo = Linea['tipo']
type FilaSaldo = { empresaId: number, cuenta: Schema<'Cuenta'>, debe: Decimal, haber: Decimal }

const FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

/**
 * Balance de saldos y estado de resultados por empresa, como `ledger/estados_financieros.ts` (A3):
 * el catálogo es común y los saldos salen de los asientos de cada empresa. Con varias empresas
 * (consolidado) una sección por empresa y `total`, la suma del grupo; con una, una sección igual
 * a `total`.
 */
function saldosPorCuenta(empresas: number[] | null, rango: { desde?: string, hasta: string }, tipos?: Tipo[]): FilaSaldo[] {
    const filas = new Map<string, FilaSaldo>()
    for (const asiento of bd.asientos) {
        const empresaId = asiento.empresa_id ?? 1
        if (asiento.fecha > rango.hasta || (rango.desde && asiento.fecha < rango.desde) || (empresas !== null && !empresas.includes(empresaId))) {
            continue
        }
        for (const movimiento of asiento.movimientos) {
            const cuenta = bd.cuentas.find(c => c.id === movimiento.cuenta_id)
            if (!cuenta || (tipos && !tipos.includes(cuenta.tipo))) {
                continue
            }
            const clave = `${empresaId}-${cuenta.id}`
            const fila = filas.get(clave) ?? { empresaId, cuenta, debe: new Decimal(0), haber: new Decimal(0) }
            fila.debe = fila.debe.plus(movimiento.debe)
            fila.haber = fila.haber.plus(movimiento.haber)
            filas.set(clave, fila)
        }
    }
    return [...filas.values()]
}

function lineas(filas: FilaSaldo[]): Linea[] {
    const porCuenta = new Map<number, FilaSaldo>()
    for (const fila of filas) {
        const actual = porCuenta.get(fila.cuenta.id) ?? { ...fila, debe: new Decimal(0), haber: new Decimal(0) }
        actual.debe = actual.debe.plus(fila.debe)
        actual.haber = actual.haber.plus(fila.haber)
        porCuenta.set(fila.cuenta.id, actual)
    }
    return [...porCuenta.values()]
        .sort((a, b) => a.cuenta.codigo.localeCompare(b.cuenta.codigo))
        .map(({ cuenta, debe, haber }) => {
            const neto = debe.minus(haber)
            const saldo = cuenta.tipo === 'activo' || cuenta.tipo === 'gasto' ? neto : neto.negated()
            return { cuenta_id: cuenta.id, codigo: cuenta.codigo, nombre: cuenta.nombre, tipo: cuenta.tipo, debe: debe.toFixed(2), haber: haber.toFixed(2), saldo: saldo.toFixed(2) }
        })
}

function suma(cuentas: Linea[], tipo: Tipo): Decimal {
    return cuentas.filter(c => c.tipo === tipo).reduce((total, c) => total.plus(c.saldo), new Decimal(0))
}

function totalesBalance(cuentas: Linea[]): Schema<'BalanceSaldos'>['total']['totales'] {
    const debe = cuentas.reduce((s, c) => s.plus(c.debe), new Decimal(0))
    const haber = cuentas.reduce((s, c) => s.plus(c.haber), new Decimal(0))
    const activo = suma(cuentas, 'activo')
    const pasivo = suma(cuentas, 'pasivo')
    const ingresos = suma(cuentas, 'ingreso')
    const gastos = suma(cuentas, 'gasto')
    const resultado = ingresos.minus(gastos)
    return {
        debe: debe.toFixed(2),
        haber: haber.toFixed(2),
        activo: activo.toFixed(2),
        pasivo: pasivo.toFixed(2),
        ingresos: ingresos.toFixed(2),
        gastos: gastos.toFixed(2),
        resultado: resultado.toFixed(2),
        cuadra: debe.equals(haber) && activo.equals(pasivo.plus(resultado)),
    }
}

function totalesResultados(cuentas: Linea[]): Schema<'EstadoResultados'>['total']['totales'] {
    const ingresos = suma(cuentas, 'ingreso')
    const gastos = suma(cuentas, 'gasto')
    return { ingresos: ingresos.toFixed(2), gastos: gastos.toFixed(2), resultado: ingresos.minus(gastos).toFixed(2) }
}

function secciones<T>(empresas: number[] | null, filas: FilaSaldo[], totales: (cuentas: Linea[]) => T) {
    const ids = [...new Set([...(empresas ?? []), ...filas.map(f => f.empresaId)])].sort((a, b) => a - b)
    const porEmpresa = ids.map((id) => {
        const cuentas = lineas(filas.filter(f => f.empresaId === id))
        const empresa = bd.empresas.find(e => e.id === id)
        return { empresa_id: id, nombre_comercial: empresa?.nombre_comercial ?? null, nit: empresa?.nit ?? null, cuentas, totales: totales(cuentas) }
    })
    const cuentas = lineas(filas)
    return { empresas: porEmpresa, total: { cuentas, totales: totales(cuentas) } }
}

function fechaInvalida(campo: string, valor: string | null) {
    return valor && !FECHA.test(valor) ? datosInvalidos([{ field: campo, message: 'Fecha AAAA-MM-DD', rule: 'date' }]) : null
}

export const rutasEstadosFinancieros: RutasFixture = {
    'GET /api/v1/libro/balance': conPermiso('libro.ver', (solicitud) => {
        const pedida = solicitud.query.get('hasta')
        const invalida = fechaInvalida('hasta', pedida)
        if (invalida) {
            return invalida
        }
        const hasta = pedida || HOY_FIXTURES
        const empresas = empresasDeLista(solicitud)
        const cuerpo: Schema<'BalanceSaldos'> = { hasta, consolidado: empresas === null, ...secciones(empresas, saldosPorCuenta(empresas, { hasta }), totalesBalance) }
        return { status: 200, cuerpo }
    }),

    'GET /api/v1/libro/estado-resultados': conPermiso('libro.ver', (solicitud) => {
        const invalida = fechaInvalida('desde', solicitud.query.get('desde')) ?? fechaInvalida('hasta', solicitud.query.get('hasta'))
        if (invalida) {
            return invalida
        }
        const hasta = solicitud.query.get('hasta') || HOY_FIXTURES
        const desde = solicitud.query.get('desde') || `${hasta.slice(0, 7)}-01`
        const empresas = empresasDeLista(solicitud)
        const filas = saldosPorCuenta(empresas, { desde, hasta }, ['ingreso', 'gasto'])
        const cuerpo: Schema<'EstadoResultados'> = { desde, hasta, consolidado: empresas === null, ...secciones(empresas, filas, totalesResultados) }
        return { status: 200, cuerpo }
    }),
}
