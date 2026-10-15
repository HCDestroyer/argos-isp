<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/** Muestra un error RFC 9457 de la API, con botón de reintento opcional. */
const props = withDefaults(defineProps<{
    problema: Problem
    reintentar?: () => void
}>(), {
    reintentar: undefined,
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
</script>

<template>
    <UAlert
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :title="problema.title"
        :description="descripcion"
        :actions="reintentar ? [{ label: 'Reintentar', color: 'error', variant: 'outline', onClick: reintentar }] : undefined"
    />
</template>
