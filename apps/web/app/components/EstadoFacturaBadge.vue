<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'

/** Estado de una factura con su color fijo (`ESTADOS_FACTURA`); uno desconocido se muestra tal cual. */
const props = withDefaults(defineProps<{
    estado: EstadoFactura
    size?: BadgeProps['size']
}>(), {
    size: 'md',
})

const visual = computed(() => estadoFacturaVisual(props.estado))
</script>

<template>
    <UBadge
        :label="visual.etiqueta"
        :icon="visual.icono"
        :color="visual.color"
        variant="subtle"
        :size="size"
    />
</template>
