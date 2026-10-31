<script setup lang="ts">
/** Modalidad de un producto (D.3): comodato, gasto o cobro, con su icono y color. */
defineProps<{
    modalidad: ModalidadProducto
}>()
</script>

<template>
    <UBadge
        :label="MODALIDADES[modalidad].etiqueta"
        :icon="MODALIDADES[modalidad].icono"
        :color="MODALIDADES[modalidad].color"
        :title="MODALIDADES[modalidad].descripcion"
        variant="subtle"
        size="sm"
    />
</template>
