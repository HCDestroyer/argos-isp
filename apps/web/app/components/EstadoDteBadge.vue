<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'

/** Estado de un DTE con icono, texto y color fijos (`ESTADOS_DTE`). */
withDefaults(defineProps<{
    estado: EstadoDte
    size?: BadgeProps['size']
}>(), {
    size: 'md',
})
</script>

<template>
    <UBadge
        :label="ESTADOS_DTE[estado].etiqueta"
        :icon="ESTADOS_DTE[estado].icono"
        :color="ESTADOS_DTE[estado].color"
        variant="subtle"
        :size="size"
        :data-estado-dte="estado"
    />
</template>
