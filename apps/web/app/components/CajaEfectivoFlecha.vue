<script setup lang="ts">
/**
 * Uno de los cuatro caminos del efectivo entre dos lugares (tablero PlanCajas): el nombre del
 * camino sobre una flecha y cuándo ocurre debajo. En el teléfono la flecha baja.
 */
defineProps<{
    camino: string
    cuando: string
}>()
</script>

<template>
    <div
        class="flex shrink-0 items-center justify-center gap-2 px-1.5 text-center text-xs font-bold text-primary lg:w-28 lg:flex-col lg:gap-1"
        aria-hidden="true"
    >
        <span>{{ camino }}</span>
        <UIcon
            name="i-lucide-arrow-right"
            class="size-4 max-lg:rotate-90"
        />
        <span class="font-medium text-muted">{{ cuando }}</span>
    </div>
</template>
