<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui'

/**
 * Estado del servicio con su mapeo único color + icono + texto (`utils/estadoServicio.ts`):
 * activo verde, limitado ámbar, suspendido rojo, retirado gris, pendiente de instalación azul.
 * `etiqueta` cambia solo el texto (p. ej. «Cortados» en el tablero), nunca el color ni el icono.
 */
const props = withDefaults(defineProps<{
    estado: EstadoServicio
    size?: BadgeProps['size']
    conIcono?: boolean
    etiqueta?: string
}>(), {
    size: 'md',
    conIcono: true,
    etiqueta: undefined,
})

const presentacion = computed(() => ESTADOS_SERVICIO[props.estado])
</script>

<template>
    <UBadge
        :label="etiqueta ?? presentacion.etiqueta"
        :color="presentacion.color"
        :icon="conIcono ? presentacion.icono : undefined"
        :size="size"
        variant="subtle"
    />
</template>
