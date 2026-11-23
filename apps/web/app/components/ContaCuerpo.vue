<script setup lang="ts">
/**
 * Cuerpo de una pantalla de Finanzas: en escritorio mide lo que queda de la ventana bajo el
 * encabezado, para que la tarjeta principal (`ContaIsla llenar`) se desplace por dentro y la página
 * no (sistema visual: «el desplazamiento ocurre dentro del contenedor»). En el teléfono fluye.
 */
withDefaults(defineProps<{
    /** Sin alto fijo: pantallas largas (paneles, formularios) que se leen de arriba abajo. */
    libre?: boolean
}>(), {
    libre: false,
})
</script>

<template>
    <div
        class="flex min-w-0 flex-col gap-4"
        :class="libre ? '' : 'lg:h-[calc(100dvh-13.25rem)] lg:min-h-[34rem]'"
    >
        <slot />
    </div>
</template>
