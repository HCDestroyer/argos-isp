import Decimal from 'decimal.js'
import type { Schema } from '@argosisp/contracts'

/**
 * Servicios del cliente agrupados por la empresa que los factura (multiempresa,
 * `.claude/integration/contratos/multiempresa.md`): cada servicio trae su `empresa` (la marca de la
 * API) y cada grupo lleva la marca, el saldo y los accesos de esa empresa, nunca mezclados.
 *
 * Orden: la empresa principal del cliente primero (la del encabezado); las demás, en el orden de
 * sus servicios.
 */

/** Marca de la empresa que factura (`PortalMarcaEmpresa`): nombre, logo, NIT y soporte. */
export type MarcaEmpresa = Schema<'PortalMarcaEmpresa'>

export interface GrupoEmpresa {
    clave: string
    empresa: MarcaEmpresa
    servicios: Schema<'PortalServicio'>[]
    /** Suma del saldo de los servicios del grupo (Dinero como texto). */
    montoAdeudado: string
}

export function agruparPorEmpresa(
    servicios: readonly Schema<'PortalServicio'>[],
    principalId: number | null = null,
): GrupoEmpresa[] {
    const grupos = new Map<number, GrupoEmpresa>()
    const totales = new Map<number, Decimal>()
    for (const servicio of servicios) {
        const id = servicio.empresa.id
        let grupo = grupos.get(id)
        if (!grupo) {
            grupo = { clave: `empresa-${id}`, empresa: servicio.empresa, servicios: [], montoAdeudado: '0.00' }
            grupos.set(id, grupo)
            totales.set(id, new Decimal(0))
        }
        grupo.servicios.push(servicio)
        totales.set(id, totales.get(id)!.plus(servicio.monto_adeudado))
    }
    const lista = [...grupos.values()].map(grupo => ({
        ...grupo,
        montoAdeudado: totales.get(grupo.empresa.id)!.toFixed(2),
    }))
    const principal = lista.findIndex(grupo => grupo.empresa.id === principalId)
    if (principal > 0) {
        lista.unshift(...lista.splice(principal, 1))
    }
    return lista
}

/** Grupo (empresa) al que pertenece un servicio, o `null`. */
export function grupoDeServicio(grupos: readonly GrupoEmpresa[], servicioId: number | undefined): GrupoEmpresa | null {
    return grupos.find(grupo => grupo.servicios.some(s => s.id === servicioId)) ?? null
}

/**
 * Manifiesto PWA con el nombre de la empresa principal del cliente (`server/routes/
 * manifest.webmanifest.get.ts`); sin ella, el de siempre (nombre configurado).
 */
export function urlManifiesto(empresaId: number | null | undefined): string {
    return empresaId ? `/manifest.webmanifest?empresa=${empresaId}` : '/manifest.webmanifest'
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
