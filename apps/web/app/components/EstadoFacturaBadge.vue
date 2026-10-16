<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'

/** Estado de una factura con su color fijo (`ESTADOS_FACTURA`). */
withDefaults(defineProps<{
    estado: EstadoFactura
    size?: BadgeProps['size']
}>(), {
    size: 'md',
})
</script>

<template>
    <UBadge
        :label="ESTADOS_FACTURA[estado].etiqueta"
        :color="ESTADOS_FACTURA[estado].color"
        variant="subtle"
        :size="size"
    />
</template>
