import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'

/** Estados del servicio (`.claude/CLAUDE.md`), desde el contrato. */
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

export function esEstadoServicio(valor: string): valor is EstadoServicio {
    return Object.hasOwn(ESTADOS_SERVICIO, valor)
}

/**
 * Opciones del filtro por estado. En la operación "cortado" es el nombre de `suspendido`
 * (pedido del PM); el valor enviado a la API es siempre el del contrato.
 */
export const ESTADOS_FILTRO: { estado: EstadoServicio, etiqueta: string }[] = [
    { estado: 'activo', etiqueta: 'Activo' },
    { estado: 'limitado', etiqueta: 'Limitado' },
    { estado: 'suspendido', etiqueta: 'Cortado (suspendido)' },
    { estado: 'retirado', etiqueta: 'Retirado' },
]
