import type { Schema } from '@argosisp/contracts'
import type { BadgeProps, SelectItem } from '@nuxt/ui'

export type TipoPlan = NonNullable<Schema<'Plan'>['tipo']>
export type Advertencia = Schema<'Advertencia'>

interface TipoPlanVisual {
    etiqueta: string
    icono: string
    color: NonNullable<BadgeProps['color']>
}

/**
 * Tipo de plan (A1, decisión del PM del 19 oct): `residencial` (por defecto), `empresarial` o
 * `dedicado`. Solo cambia advertencias y reportes, nunca la velocidad. Color neutro para
 * residencial; los otros dos se distinguen también por el icono y el texto.
 */
export const TIPOS_PLAN: Record<TipoPlan, TipoPlanVisual> = {
    residencial: { etiqueta: 'Residencial', icono: 'i-lucide-house', color: 'neutral' },
    empresarial: { etiqueta: 'Empresarial', icono: 'i-lucide-building', color: 'info' },
    dedicado: { etiqueta: 'Dedicado', icono: 'i-lucide-cable', color: 'primary' },
}

export const ITEMS_TIPO_PLAN: SelectItem[] = Object.entries(TIPOS_PLAN).map(([value, t]) => ({ label: t.etiqueta, value, icon: t.icono }))

export function esTipoPlan(valor: unknown): valor is TipoPlan {
    return typeof valor === 'string' && Object.hasOwn(TIPOS_PLAN, valor)
}

/** Cómo se ve el tipo; sin tipo (una API anterior) no se muestra nada; uno desconocido, por su nombre. */
export function tipoPlanVisual(tipo: string | null | undefined): TipoPlanVisual | null {
    if (!tipo) {
        return null
    }
    if (esTipoPlan(tipo)) {
        return TIPOS_PLAN[tipo]
    }
    return { etiqueta: tipo.charAt(0).toUpperCase() + tipo.slice(1), icono: 'i-lucide-tag', color: 'neutral' }
}

/**
 * Las advertencias (`warnings[]`) de crear o editar un plan o un servicio: el cambio ya se guardó,
 * así que se muestran como aviso, nunca como error. Sin advertencias no se muestra nada.
 */
export function avisarAdvertencias(toast: ReturnType<typeof useToast>, advertencias: readonly Advertencia[] | undefined, titulo: string): void {
    if (!advertencias?.length) {
        return
    }
    toast.add({
        title: titulo,
        description: advertencias.map(a => a.mensaje).join(' · '),
        icon: 'i-lucide-triangle-alert',
        color: 'warning',
        duration: 10_000,
    })
}
