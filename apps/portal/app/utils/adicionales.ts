import type { BadgeProps } from '@nuxt/ui'
import type { Schema } from '@argosisp/contracts'

export type AdicionalPortal = Schema<'PortalAdicional'>
export type TipoPlan = NonNullable<Schema<'PortalServicio'>['plan_tipo']>

/** Cómo se dice el tipo de plan al cliente (`network.planes.tipo`). */
export const TIPOS_PLAN: Record<TipoPlan, string> = {
    residencial: 'Residencial',
    empresarial: 'Empresarial',
    dedicado: 'Dedicado',
}

/**
 * Lo que el cliente lee de la modalidad de un adicional: «Incluido en tu plan», «Cortesía» o el
 * precio mensual («Q 35.00 al mes»). Un `cobrado` sin precio (no debería pasar: la base lo exige)
 * dice «Cobrado aparte» en lugar de inventar un monto.
 */
export function textoModalidad(adicional: Pick<AdicionalPortal, 'modalidad' | 'precio'>): string {
    if (adicional.modalidad === 'incluido') {
        return 'Incluido en tu plan'
    }
    if (adicional.modalidad === 'cortesia') {
        return 'Cortesía'
    }
    return adicional.precio ? `${formatearQuetzales(adicional.precio)} al mes` : 'Cobrado aparte'
}

export function colorModalidad(modalidad: AdicionalPortal['modalidad']): NonNullable<BadgeProps['color']> {
    return modalidad === 'incluido' ? 'primary' : modalidad === 'cortesia' ? 'success' : 'neutral'
}
