import type { BadgeProps } from '@nuxt/ui'

/** Tono de una pastilla de icono del sistema visual (`.ax-pastilla[data-tono]` en `main.css`). */
export type TonoPastilla = 'primary' | 'success' | 'warning' | 'error' | 'info' | 'neutral'

/** El tono de la pastilla que acompaña a un estado (el color de su badge). */
export function tonoDeColor(color: BadgeProps['color']): TonoPastilla {
    return color === 'success' || color === 'warning' || color === 'error' || color === 'info' || color === 'neutral'
        ? color
        : 'primary'
}
