<script setup lang="ts">
/** Estado de un sorteo con su color fijo (`ESTADOS_SORTEO`); uno nuevo se muestra por su nombre. */
const props = defineProps<{
    estado: string
}>()

const visual = computed(() => estadoSorteoVisual(props.estado))
</script>

<template>
    <UBadge
        :label="visual.etiqueta"
        :icon="visual.icono"
        :color="visual.color"
        variant="subtle"
        :data-estado="estado"
    />
</template>
