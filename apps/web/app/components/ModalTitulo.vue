<script setup lang="ts">
/**
 * Título de un modal del sistema visual Argos: icono en pastilla tintada según el tipo
 * (información en primario, advertencia en ámbar, peligro en rojo) y el texto. Va en el slot
 * `#title` de `UModal`, así el texto sigue siendo el nombre accesible del diálogo.
 */
const props = withDefaults(defineProps<{
    texto: string
    icono: string
    tipo?: 'info' | 'advertencia' | 'peligro'
}>(), {
    tipo: 'info',
})

const clase = computed(() => ({
    info: 'bg-primary/10 text-primary',
    advertencia: 'bg-warning/10 text-warning',
    peligro: 'bg-error/10 text-error',
})[props.tipo])
</script>

<template>
    <span class="flex items-center gap-3">
        <span
            class="pastilla-icono"
            :class="clase"
            aria-hidden="true"
        >
            <UIcon
                :name="icono"
                class="size-5"
            />
        </span>
        <span>{{ texto }}</span>
    </span>
</template>
