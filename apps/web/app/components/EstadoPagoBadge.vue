<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'

/** Estado de un pago con su color fijo (`ESTADOS_PAGO`). */
withDefaults(defineProps<{
    estado: EstadoPago
    size?: BadgeProps['size']
}>(), {
    size: 'md',
})
</script>

<template>
    <UBadge
        :label="ESTADOS_PAGO[estado].etiqueta"
        :icon="ESTADOS_PAGO[estado].icono"
        :color="ESTADOS_PAGO[estado].color"
        variant="subtle"
        :size="size"
    />
</template>
