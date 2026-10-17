import type { BadgeProps } from '@nuxt/ui'

/**
 * Estados de ArgosIsp sin tipo propio en el contrato, con la regla de la identidad
 * (`horus-identity/references/estados.md`): la urgencia decide el color, el icono distingue la
 * identidad y el texto siempre está. Nunca `primary` para un estado. El mapeo completo, con los
 * estados del servicio, facturas, comprobantes y promesas, está en `apps/web/docs/identidad.md`.
 */
export interface PresentacionEstadoUi {
    etiqueta: string
    color: NonNullable<BadgeProps['color']>
    icono: string
}

/** Bandera "promesa activa" del servicio (no es un estado): solo informa. */
export const PROMESA_ACTIVA: PresentacionEstadoUi = { etiqueta: 'Promesa activa', color: 'info', icono: 'i-lucide-calendar-clock' }

/** Sesión PPPoE del servicio. Desconectada no es urgente: el cliente puede tener el equipo apagado. */
export type EstadoSesion = 'en_linea' | 'desconectada'

export const ESTADOS_SESION: Record<EstadoSesion, PresentacionEstadoUi> = {
    en_linea: { etiqueta: 'En línea', color: 'success', icono: 'i-lucide-plug-zap' },
    desconectada: { etiqueta: 'Desconectada', color: 'neutral', icono: 'i-lucide-unplug' },
}

/**
 * Router (equipo). La API todavía no expone si el router responde (pedido a A1/A2 en
 * `.claude/integration/a4.md`); el mapeo queda listo para cuando llegue.
 */
export type EstadoRouter = 'en_linea' | 'caido'

export const ESTADOS_ROUTER: Record<EstadoRouter, PresentacionEstadoUi> = {
    en_linea: { etiqueta: 'En línea', color: 'success', icono: 'i-lucide-circle-check' },
    caido: { etiqueta: 'Fuera de línea', color: 'error', icono: 'i-lucide-circle-x' },
}
