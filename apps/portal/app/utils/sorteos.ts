import type { BadgeProps } from '@nuxt/ui'
import type { Schema } from '@argosisp/contracts'

type EstadoSorteo = Schema<'PortalSorteo'>['estado']

export const ESTADOS_SORTEO: Record<EstadoSorteo, { etiqueta: string, color: NonNullable<BadgeProps['color']>, icono: string }> = {
    borrador: { etiqueta: 'En preparación', color: 'neutral', icono: 'i-lucide-pencil' },
    bases_publicadas: { etiqueta: 'Próximamente', color: 'info', icono: 'i-lucide-megaphone' },
    participacion_abierta: { etiqueta: 'Participación abierta', color: 'success', icono: 'i-lucide-ticket' },
    corte_cerrado: { etiqueta: 'Lista cerrada', color: 'warning', icono: 'i-lucide-list-checks' },
    ejecutado: { etiqueta: 'Sorteado', color: 'primary', icono: 'i-lucide-trophy' },
    premios_entregados: { etiqueta: 'Premios entregados', color: 'primary', icono: 'i-lucide-gift' },
    cancelado: { etiqueta: 'Cancelado', color: 'error', icono: 'i-lucide-circle-x' },
}

/** ¿Ya hay resultado? */
export function sorteoTerminado(estado: EstadoSorteo): boolean {
    return estado === 'ejecutado' || estado === 'premios_entregados'
}

/** Ruta de la página pública de bases, resultado y verificación. */
export function rutaSorteoPublico(id: number): string {
    return `/sorteos/${id}`
}

/**
 * Solo imágenes del mismo origen (ruta `/…`): el portal sirve todo desde su servidor (CSP
 * `img-src 'self'` y walled garden en la página de corte). Una URL externa no se pinta.
 */
export function imagenDelPortal(url: string | null | undefined): string | null {
    return url && url.startsWith('/') && !url.startsWith('//') ? url : null
}

/** «1 boleto», «4 boletos». */
export function boletosEnTexto(boletos: number): string {
    return `${formatearPuntos(boletos)} ${boletos === 1 ? 'boleto' : 'boletos'}`
}

/** Fecha y hora de Guatemala para un sorteo («15/11/2026 a las 18:00»). */
export function fechaHoraSorteo(valor: string | null): string {
    if (!valor) {
        return 'Fecha por confirmar'
    }
    return formatearFechaHora(valor)
}
