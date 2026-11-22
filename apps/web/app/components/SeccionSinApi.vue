<script setup lang="ts">
/**
 * Sección que el diseño ya muestra y la API todavía no da (contactos, soporte, documentos…): vacío
 * honesto, sin datos inventados, con qué falta. El pedido al dueño está en `.claude/integration/a4.md`.
 */
defineProps<{
    titulo: string
    descripcion: string
    icono: string
}>()
</script>

<template>
    <UEmpty
        :icon="icono"
        :title="titulo"
        :description="descripcion"
        variant="naked"
        data-prueba="seccion-sin-api"
    />
</template>
