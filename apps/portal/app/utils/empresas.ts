import Decimal from 'decimal.js'
import type { Schema } from '@argosisp/contracts'

/**
 * Servicios del cliente agrupados por la empresa que los factura.
 *
 * Hoy hay una sola empresa (`GET /portal/empresa`) y todo cae en un grupo. Con multiempresa
 * (`.claude/integration/contratos/multiempresa.md`) cada servicio traerá su `empresa_id` y la
 * cuenta, las empresas con su marca: este es el único lugar que cambia. El inicio ya pinta una
 * sección por grupo, y la cabecera con la marca de la empresa aparece cuando hay más de uno.
 */

/** Marca de la empresa que factura (nombre y logo). `id` null = la única empresa de hoy. */
export interface MarcaEmpresa {
    id: number | null
    nombre: string
    logoUrl: string | null
}

export interface GrupoEmpresa {
    clave: string
    empresa: MarcaEmpresa
    servicios: Schema<'PortalServicio'>[]
    /** Suma del saldo de los servicios del grupo (Dinero como texto). */
    montoAdeudado: string
}

export function agruparPorEmpresa(
    servicios: readonly Schema<'PortalServicio'>[],
    empresaUnica: MarcaEmpresa,
): GrupoEmpresa[] {
    if (servicios.length === 0) {
        return []
    }
    const total = servicios.reduce((suma, s) => suma.plus(s.monto_adeudado), new Decimal(0))
    return [{
        clave: `empresa-${empresaUnica.id ?? 'principal'}`,
        empresa: empresaUnica,
        servicios: [...servicios],
        montoAdeudado: total.toFixed(2),
    }]
}

/** Estado más urgente entre los servicios (lo que se muestra en el encabezado compacto). */
const URGENCIA: Record<EstadoServicio, number> = { suspendido: 3, limitado: 2, activo: 1, retirado: 0 }

export function estadoMasUrgente(servicios: readonly { estado: EstadoServicio }[]): EstadoServicio | null {
    let peor: EstadoServicio | null = null
    for (const { estado } of servicios) {
        if (peor === null || URGENCIA[estado] > URGENCIA[peor]) {
            peor = estado
        }
    }
    return peor
}
