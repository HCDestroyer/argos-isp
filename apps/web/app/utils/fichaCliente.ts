import type { Schema } from '@argosisp/contracts'
import Decimal from 'decimal.js'

type Servicio = Schema<'Servicio'>
type EstadoCuenta = Schema<'EstadoCuenta'>

/**
 * Cálculos de la ficha y la vista rápida del cliente (tableros NuevoClienteFicha y NuevoClientes),
 * siempre sobre datos leídos de la API: sin cuenta o sin servicios devuelven `null` y la pantalla
 * muestra el aviso, nunca un cero.
 */

/** Orden de gravedad: el peor servicio manda en el estado del cliente. */
const GRAVEDAD: EstadoServicio[] = ['suspendido', 'limitado', 'pendiente_instalacion', 'activo', 'retirado']

/** Peor estado entre los servicios no retirados (o `retirado` si todos lo están). */
export function peorEstadoServicios(servicios: Pick<Servicio, 'estado'>[] | null): EstadoServicio | null {
    if (!servicios?.length) {
        return null
    }
    return GRAVEDAD.find(estado => servicios.some(s => s.estado === estado)) ?? null
}

export interface ResumenCuentaCliente {
    saldo: string
    debe: boolean
    vencidas: number
    /** Factura pendiente que vence primero y todavía no venció. */
    proxima: { vence_en: string, total: string } | null
}

export function resumenCuentaCliente(cuenta: EstadoCuenta | null, _servicios?: Servicio[] | null): ResumenCuentaCliente | null {
    if (!cuenta) {
        return null
    }
    const pendientes = cuenta.facturas_pendientes
    const porVencer = pendientes
        .filter(f => f.estado !== 'vencida')
        .sort((a, b) => a.vence_en.localeCompare(b.vence_en))
    const proxima = porVencer[0]
    return {
        saldo: cuenta.saldo,
        debe: new Decimal(cuenta.saldo).gt(0),
        vencidas: pendientes.filter(f => f.estado === 'vencida').length,
        proxima: proxima ? { vence_en: proxima.vence_en, total: proxima.total } : null,
    }
}

/** «2 suspendidos», «1 activo», «2 activos · 1 suspendido» (servicios no retirados). */
export function textoServiciosCliente(servicios: Pick<Servicio, 'estado'>[]): string {
    const vivos = servicios.filter(s => s.estado !== 'retirado')
    if (!vivos.length) {
        return servicios.length ? 'Retirados' : 'Ninguno'
    }
    const conteo = new Map<EstadoServicio, number>()
    for (const servicio of vivos) {
        conteo.set(servicio.estado, (conteo.get(servicio.estado) ?? 0) + 1)
    }
    const plural: Partial<Record<EstadoServicio, [string, string]>> = {
        activo: ['activo', 'activos'],
        limitado: ['limitado', 'limitados'],
        suspendido: ['suspendido', 'suspendidos'],
        pendiente_instalacion: ['por instalar', 'por instalar'],
    }
    return GRAVEDAD
        .filter(estado => conteo.has(estado) && plural[estado])
        .map((estado) => {
            const n = conteo.get(estado)!
            return `${n} ${plural[estado]![n === 1 ? 0 : 1]}`
        })
        .join(' · ')
}

/** Suma de `precio_mensual` de los servicios no retirados. */
export function sumarPrecios(servicios: Pick<Servicio, 'estado' | 'precio_mensual'>[]): Decimal {
    return servicios
        .filter(s => s.estado !== 'retirado')
        .reduce((suma, s) => suma.plus(s.precio_mensual), new Decimal(0))
}
