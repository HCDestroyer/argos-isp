import type { BadgeProps } from '@nuxt/ui'
import type { Schema } from '@argosisp/contracts'

/** Estados del servicio (`.claude/CLAUDE.md`), del esquema `EstadoServicio` del OpenAPI. */
export type EstadoServicio = Schema<'EstadoServicio'>

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
