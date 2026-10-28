import type { BadgeProps } from '@nuxt/ui'
import type { Schema } from '@argosisp/contracts'

/** Estados del servicio (`.claude/CLAUDE.md`), del esquema `EstadoServicio` del OpenAPI. */
export type EstadoServicio = Schema<'EstadoServicio'>

interface PresentacionEstado {
    etiqueta: string
    color: NonNullable<BadgeProps['color']>
    icono: string
}

/**
 * Colores fijos: activo verde, limitado ámbar, suspendido rojo, retirado gris y pendiente de
 * instalación azul (informativo: no es un corte; `contratos/instalacion.md` §3).
 */
export const ESTADOS_SERVICIO: Record<EstadoServicio, PresentacionEstado> = {
    pendiente_instalacion: { etiqueta: 'Instalación pendiente', color: 'info', icono: 'i-lucide-calendar-clock' },
    activo: { etiqueta: 'Activo', color: 'success', icono: 'i-lucide-circle-check' },
    limitado: { etiqueta: 'Limitado', color: 'warning', icono: 'i-lucide-gauge' },
    suspendido: { etiqueta: 'Suspendido', color: 'error', icono: 'i-lucide-circle-x' },
    retirado: { etiqueta: 'Retirado', color: 'neutral', icono: 'i-lucide-archive' },
}

/**
 * Vendido y aún sin instalar: no navega todavía, no se factura la mensualidad y no hay corte,
 * promesa ni velocidad que mostrar; solo sus cargos únicos (instalación, equipo…).
 */
export function esPendienteInstalacion(estado: EstadoServicio | null | undefined): boolean {
    return estado === 'pendiente_instalacion'
}
