import type { Schema } from '@argosisp/contracts'
import type { BadgeProps } from '@nuxt/ui'

type Estado = Schema<'Pago'>['estado']

export const ESTADOS_PAGO: Record<Estado, { etiqueta: string, color: NonNullable<BadgeProps['color']>, icono: string }> = {
    registrado: { etiqueta: 'Registrado', color: 'success', icono: 'i-lucide-circle-check' },
    pendiente_verificacion: { etiqueta: 'Por verificar', color: 'warning', icono: 'i-lucide-hourglass' },
    anulado: { etiqueta: 'Anulado', color: 'neutral', icono: 'i-lucide-ban' },
}
