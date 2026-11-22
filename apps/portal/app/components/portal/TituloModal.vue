<script setup lang="ts">
/**
 * Título de modal o drawer del sistema visual: pastilla de icono tintada según el tipo (primario
 * para acciones, éxito, aviso o error para confirmaciones) y el texto. Va en el slot `#title`.
 */
const props = withDefaults(defineProps<{
    texto: string
    icono: string
    tono?: TonoPastilla
}>(), {
    tono: 'primary',
})
</script>

<template>
    <span class="flex items-center gap-3">
        <PortalPastilla
            :icono="props.icono"
            :tono="props.tono"
        />
        <span class="min-w-0">{{ props.texto }}</span>
    </span>
</template>
