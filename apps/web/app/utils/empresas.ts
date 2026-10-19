import Decimal from 'decimal.js'
import { saldoFactura } from './cobro'

/** Filas de una misma empresa (multiempresa: el cliente se ve agrupado por la empresa de cada servicio). */
export interface GrupoEmpresa<T> {
    /** `null` = no se pudo saber la empresa (p. ej. una factura sin servicio). */
    empresaId: number | null
    filas: T[]
}

/** Agrupa conservando el orden de las filas; las empresas en orden de id y la desconocida al final. */
export function agruparPorEmpresa<T>(filas: readonly T[], empresaDe: (fila: T) => number | null | undefined): GrupoEmpresa<T>[] {
    const grupos = new Map<number | null, T[]>()
    for (const fila of filas) {
        const id = empresaDe(fila) ?? null
        const lista = grupos.get(id) ?? []
        lista.push(fila)
        grupos.set(id, lista)
    }
    return [...grupos.entries()]
        .sort(([a], [b]) => (a === null ? 1 : b === null ? -1 : a - b))
        .map(([empresaId, lista]) => ({ empresaId, filas: lista }))
}

/** Empresa de una factura por la de su servicio (la API aún no trae `Factura.empresa_id`). */
export function empresaDeFactura(factura: { servicio_id: number | null }, servicios: readonly { id: number, empresa_id: number }[]): number | null {
    return servicios.find(s => s.id === factura.servicio_id)?.empresa_id ?? null
}

/** Lo que falta pagar de unas facturas (`saldoFactura`: el estado manda), con `decimal.js`. */
export function pendienteDeFacturas(facturas: readonly Parameters<typeof saldoFactura>[0][]): Decimal {
    return facturas.reduce((suma, f) => suma.plus(saldoFactura(f)), new Decimal(0))
}

/**
 * Empresa sugerida para un servicio nuevo, la misma regla que `CrearServicio` (A1): la de la zona del
 * cliente > la del router > la empresa activa de quien lo crea. `motivo` es para mostrarlo.
 */
export function sugerenciaEmpresa(origen: {
    zona: { nombre: string, empresa_sugerida_id: number | null } | null
    router: { nombre: string, empresa_sugerida_id: number | null } | null
    activa: number | null
}): { empresaId: number | null, motivo: string | null } {
    if (origen.zona?.empresa_sugerida_id) {
        return { empresaId: origen.zona.empresa_sugerida_id, motivo: `por la zona ${origen.zona.nombre}` }
    }
    if (origen.router?.empresa_sugerida_id) {
        return { empresaId: origen.router.empresa_sugerida_id, motivo: `por el router ${origen.router.nombre}` }
    }
    if (origen.activa) {
        return { empresaId: origen.activa, motivo: 'por tu empresa activa' }
    }
    return { empresaId: null, motivo: null }
}

/** Una parte del cobro: lo que se paga a una empresa (un pago por empresa, `contratos/multiempresa.md`). */
export interface ParteCobro {
    empresaId: number | null
    facturas: number[]
    total: Decimal
}

/**
 * Cómo se reparte un cobro entre empresas: las facturas marcadas agrupadas por la empresa de su
 * servicio, con lo que falta pagar de cada una. La API registra un pago por empresa (cada uno en la
 * caja de esa empresa); con una sola empresa queda una parte.
 */
export function repartoPorEmpresa(
    facturas: readonly { id: number, servicio_id: number | null, total: string, pagado: string }[],
    marcadas: readonly number[],
    servicios: readonly { id: number, empresa_id: number }[],
): ParteCobro[] {
    const elegidas = marcadas
        .map(id => facturas.find(f => f.id === id))
        .filter((f): f is NonNullable<typeof f> => f !== undefined)
    return agruparPorEmpresa(elegidas, f => empresaDeFactura(f, servicios)).map(grupo => ({
        empresaId: grupo.empresaId,
        facturas: grupo.filas.map(f => f.id),
        total: pendienteDeFacturas(grupo.filas),
    }))
}
