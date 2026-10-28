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

/** Lo del cliente con una empresa (`PortalCuentaEmpresa`): saldo de su libro y facturas pendientes. */
export type CuentaEmpresa = Schema<'PortalCuentaEmpresa'>

export interface GrupoEmpresa {
    clave: string
    empresa: MarcaEmpresa
    servicios: Schema<'PortalServicio'>[]
    /**
     * Lo que se le debe a esta empresa (Dinero como texto): el saldo de su sección del estado de
     * cuenta cuando la hay; si no, la suma del saldo de los servicios del grupo.
     */
    montoAdeudado: string
    /** Saldo, saldo a favor y facturas pendientes con esta empresa (`PortalCuenta.empresas`). */
    cuenta: CuentaEmpresa | null
}

export function agruparPorEmpresa(
    servicios: readonly Schema<'PortalServicio'>[],
    principalId: number | null = null,
    secciones: readonly CuentaEmpresa[] = [],
): GrupoEmpresa[] {
    const grupos = new Map<number, GrupoEmpresa>()
    const totales = new Map<number, Decimal>()
    for (const servicio of servicios) {
        const id = servicio.empresa.id
        let grupo = grupos.get(id)
        if (!grupo) {
            grupo = { clave: `empresa-${id}`, empresa: servicio.empresa, servicios: [], montoAdeudado: '0.00', cuenta: null }
            grupos.set(id, grupo)
            totales.set(id, new Decimal(0))
        }
        grupo.servicios.push(servicio)
        totales.set(id, totales.get(id)!.plus(servicio.monto_adeudado))
    }
    // Una empresa con saldo pero sin servicios vigentes (p. ej. un servicio que cambió de empresa)
    // también tiene su sección: su deuda es con ese NIT.
    for (const seccion of secciones) {
        if (!grupos.has(seccion.empresa.id)) {
            grupos.set(seccion.empresa.id, { clave: `empresa-${seccion.empresa.id}`, empresa: seccion.empresa, servicios: [], montoAdeudado: '0.00', cuenta: null })
            totales.set(seccion.empresa.id, new Decimal(0))
        }
    }
    const lista = [...grupos.values()].map((grupo) => {
        const cuenta = secciones.find(seccion => seccion.empresa.id === grupo.empresa.id) ?? null
        return {
            ...grupo,
            cuenta,
            montoAdeudado: cuenta ? new Decimal(cuenta.saldo).toFixed(2) : totales.get(grupo.empresa.id)!.toFixed(2),
        }
    })
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

/**
 * Estado más urgente entre los servicios (lo que se muestra en el encabezado compacto), con el
 * mismo orden que la API (`estado_servicio` del cliente): suspendido > limitado > activo >
 * pendiente de instalación > retirado.
 */
const URGENCIA: Record<EstadoServicio, number> = {
    suspendido: 4,
    limitado: 3,
    activo: 2,
    pendiente_instalacion: 1,
    retirado: 0,
}

export function estadoMasUrgente(servicios: readonly { estado: EstadoServicio }[]): EstadoServicio | null {
    let peor: EstadoServicio | null = null
    for (const { estado } of servicios) {
        if (peor === null || URGENCIA[estado] > URGENCIA[peor]) {
            peor = estado
        }
    }
    return peor
}

/** Facturas pendientes y vencidas de una empresa, en palabras ("3 facturas pendientes, 2 vencidas"). */
export function resumenFacturas(cuenta: CuentaEmpresa | null): string | null {
    const pendientes = cuenta?.facturas_pendientes ?? []
    if (pendientes.length === 0) {
        return null
    }
    const vencidas = pendientes.filter(f => f.vencida).length
    const texto = pendientes.length === 1 ? '1 factura pendiente' : `${pendientes.length} facturas pendientes`
    if (vencidas === 0) {
        return texto
    }
    return vencidas === pendientes.length
        ? `${texto}, ${vencidas === 1 ? 'vencida' : 'todas vencidas'}`
        : `${texto}, ${vencidas} ${vencidas === 1 ? 'vencida' : 'vencidas'}`
}
