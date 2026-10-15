<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'

const props = withDefaults(defineProps<{
    estado: EstadoServicio
    size?: BadgeProps['size']
    conIcono?: boolean
}>(), {
    size: 'md',
    conIcono: true,
})

const presentacion = computed(() => ESTADOS_SERVICIO[props.estado])
</script>

<template>
    <UBadge
        :label="presentacion.etiqueta"
        :color="presentacion.color"
        :icon="conIcono ? presentacion.icono : undefined"
        :size="size"
        variant="subtle"
    />
</template>
