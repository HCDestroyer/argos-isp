<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'

/**
 * Badge "Suspendido manualmente" (decisión del PM): un operador suspendió el servicio a mano y
 * ni el corte automático ni los pagos lo reactivan; solo "Reactivar". El motivo va en el
 * tooltip y, con `conMotivo`, también a la vista (teléfono, recibo).
 */
const props = withDefaults(defineProps<{
    servicio: Pick<Servicio, 'suspension_manual' | 'suspension_manual_motivo'>
    size?: BadgeProps['size']
    conMotivo?: boolean
}>(), {
    size: 'md',
    conMotivo: false,
})

const motivo = computed(() => props.servicio.suspension_manual_motivo?.trim() || null)
const ayuda = computed(() => (motivo.value
    ? `Motivo: ${motivo.value}. Solo "Reactivar" quita esta suspensión.`
    : 'Solo "Reactivar" quita esta suspensión.'))
</script>

<template>
    <span
        v-if="servicio.suspension_manual"
        class="inline-flex min-w-0 flex-col gap-0.5"
        data-prueba="suspension-manual"
    >
        <UTooltip :text="ayuda">
            <UBadge
                label="Suspendido manualmente"
                icon="i-lucide-hand"
                color="error"
                variant="outline"
                :size="size"
                class="self-start"
                :aria-label="`Suspendido manualmente. ${ayuda}`"
            />
        </UTooltip>
        <span
            v-if="conMotivo && motivo"
            class="line-clamp-2 max-w-56 text-xs text-muted"
        >{{ motivo }}</span>
    </span>
</template>
