<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Muestra un error RFC 9457 de la API, con botón de reintento opcional. Úsalo en lugar de los
 * datos que no se pudieron leer, nunca junto a totales o tablas vacías.
 */
const props = withDefaults(defineProps<{
    problema: Problem
    reintentar?: () => void
    /** Pone el botón "Reintentar" en espera mientras se repite la llamada. */
    reintentando?: boolean
}>(), {
    reintentar: undefined,
    reintentando: false,
})

const descripcion = computed(() => {
    if (props.problema.detail) {
        return props.problema.detail
    }
    if (props.problema.status === 501) {
        return 'El backend todavía no implementa este endpoint.'
    }
    return undefined
})

const acciones = computed(() => {
    if (!props.reintentar) {
        return undefined
    }
    return [{
        label: 'Reintentar',
        icon: 'i-lucide-rotate-cw',
        color: 'error' as const,
        variant: 'outline' as const,
        loading: props.reintentando,
        onClick: props.reintentar,
    }]
})
</script>

<template>
    <UAlert
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="problema.title"
        :description="descripcion"
        :actions="acciones"
    />
</template>
