<script setup lang="ts">
/**
 * Columna de acciones de una fila: iconos con tooltip (ver, editar, cobrar…). Las mismas acciones
 * van en el menú contextual de la fila (`useMenuFila`).
 */
const props = defineProps<{
    acciones: AccionFila[]
    /** Nombre de la fila, para el `aria-label` de cada icono («Editar María Pérez»). */
    nombre: string
}>()

const visibles = computed(() => props.acciones.filter(accion => !accion.soloMenu))
</script>

<template>
    <div class="flex items-center justify-end gap-0.5">
        <!-- Tooltip nativo (`title`): las pruebas montan las pantallas sin el proveedor de UApp. -->
        <UButton
            v-for="accion in visibles"
            :key="accion.etiqueta"
            :icon="accion.icono"
            :to="accion.to"
            :color="accion.color === 'error' ? 'error' : 'neutral'"
            variant="ghost"
            size="sm"
            :title="accion.etiqueta"
            :aria-label="`${accion.etiqueta}: ${nombre}`"
            @click="accion.alElegir?.()"
        />
    </div>
</template>
