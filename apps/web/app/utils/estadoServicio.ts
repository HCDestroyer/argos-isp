import type { BadgeProps } from '@nuxt/ui'

/**
 * Estados del servicio (`.claude/CLAUDE.md`). TODO(A4): cuando el OpenAPI publique el
 * esquema `Servicio`, cambiar por `Schema<'Servicio'>['estado']`.
 */
export type EstadoServicio = 'activo' | 'limitado' | 'suspendido' | 'retirado'

interface PresentacionEstado {
    etiqueta: string
    color: NonNullable<BadgeProps['color']>
    icono: string
}

/** Colores fijos: activo verde, limitado ámbar, suspendido rojo, retirado gris. */
export const ESTADOS_SERVICIO: Record<EstadoServicio, PresentacionEstado> = {
    activo: { etiqueta: 'Activo', color: 'success', icono: 'i-lucide-circle-check' },
    limitado: { etiqueta: 'Limitado', color: 'warning', icono: 'i-lucide-gauge' },
    suspendido: { etiqueta: 'Suspendido', color: 'error', icono: 'i-lucide-circle-x' },
    retirado: { etiqueta: 'Retirado', color: 'neutral', icono: 'i-lucide-archive' },
}
