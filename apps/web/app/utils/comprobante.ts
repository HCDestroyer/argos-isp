import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'
import * as z from 'zod'
import { formatearFechaHora } from './formato'

type Comprobante = Schema<'Comprobante'>
type Estado = Comprobante['estado']

export const ESTADOS_COMPROBANTE: Record<Estado, { etiqueta: string, plural: string, color: NonNullable<BadgeProps['color']>, icono: string }> = {
    pendiente: { etiqueta: 'Pendiente', plural: 'Pendientes', color: 'warning', icono: 'i-lucide-hourglass' },
    aprobado: { etiqueta: 'Aprobado', plural: 'Aprobados', color: 'success', icono: 'i-lucide-circle-check' },
    rechazado: { etiqueta: 'Rechazado', plural: 'Rechazados', color: 'neutral', icono: 'i-lucide-circle-x' },
}

export const CANALES_COMPROBANTE: Record<Comprobante['canal'], string> = {
    portal: 'Portal del cliente',
    panel: 'Panel',
}

/** Quién lo aprobó o rechazó: su nombre (`verificado_por_nombre`), o `usuario #N` si no vino. */
export function revisadoPor(comprobante: Pick<Comprobante, 'verificado_por' | 'verificado_por_nombre'>): string | null {
    if (comprobante.verificado_por_nombre) {
        return comprobante.verificado_por_nombre
    }
    return comprobante.verificado_por ? `usuario #${comprobante.verificado_por}` : null
}

/** Texto de la revisión: `Revisado el 16/10/2026 10:30 por Ana Administradora`. */
export function textoRevision(comprobante: Pick<Comprobante, 'verificado_en' | 'verificado_por' | 'verificado_por_nombre'>): string | null {
    if (!comprobante.verificado_en) {
        return null
    }
    const quien = revisadoPor(comprobante)
    return `Revisado el ${formatearFechaHora(comprobante.verificado_en)}${quien ? ` por ${quien}` : ''}`
}

export function esEstadoComprobante(valor: unknown): valor is Estado {
    return typeof valor === 'string' && valor in ESTADOS_COMPROBANTE
}

/** El archivo se ve como imagen (`<img>`) o como PDF (`<iframe>`). */
export function esPdf(comprobante: Pick<Comprobante, 'archivo_tipo'>): boolean {
    return comprobante.archivo_tipo === 'application/pdf'
}

/** `734` → `734 B`, `51200` → `50 KB`, `1572864` → `1.5 MB`. */
export function formatearTamano(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`
    }
    if (bytes < 1024 * 1024) {
        return `${Math.round(bytes / 1024)} KB`
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 409 `comprobante_revisado`: otra persona ya lo aprobó o rechazó; hay que recargar. */
export function esComprobanteRevisado(problema: { status: number, type: string }): boolean {
    return problema.status === 409 && problema.type.endsWith(':comprobante_revisado')
}

/** Espejo de `aprobarComprobanteValidator` (A3): nota opcional de hasta 400 caracteres. */
export const esquemaAprobarComprobante = z.object({
    nota: z.string().trim().max(400, 'Máximo 400 caracteres'),
})

export type EntradaAprobarComprobante = z.input<typeof esquemaAprobarComprobante>
export type SalidaAprobarComprobante = z.output<typeof esquemaAprobarComprobante>

/**
 * Facturas a las que irá el pago si no se elige ninguna: como `AprobarComprobante`, las pendientes
 * del servicio del comprobante (la más antigua primero); sin servicio, ninguna (la API aplica a la
 * más antigua del cliente).
 */
export function facturasPorDefectoComprobante(comprobante: Pick<Comprobante, 'servicio_id'>, pendientes: readonly Schema<'Factura'>[]): number[] {
    if (comprobante.servicio_id === null) {
        return []
    }
    return pendientes
        .filter(f => f.servicio_id === comprobante.servicio_id)
        .sort((a, b) => a.vence_en.localeCompare(b.vence_en) || a.periodo.localeCompare(b.periodo) || a.id - b.id)
        .map(f => f.id)
}
