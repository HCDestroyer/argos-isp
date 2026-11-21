<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'

/**
 * Menú «⋯» de una fila en las listas de Finanzas (sistema visual: menú en cada fila, agrupado y con
 * lo destructivo al final). Sin acciones no se pinta.
 */
const props = defineProps<{
    acciones: AccionFila[]
    /** Nombre de la fila, para el `aria-label` («Más acciones: Compra 12»). */
    nombre: string
}>()

const items = computed<DropdownMenuItem[][]>(() => agruparAcciones(props.acciones, accion => ({
    label: accion.etiqueta,
    icon: accion.icono,
    to: accion.to,
    color: accion.color,
    onSelect: accion.alElegir,
})))
</script>

<template>
    <UDropdownMenu
        v-if="acciones.length"
        :items="items"
        :content="{ align: 'end' }"
    >
        <UButton
            icon="i-lucide-ellipsis"
            color="neutral"
            variant="ghost"
            size="sm"
            :aria-label="`Más acciones: ${nombre}`"
            data-prueba="menu-fila"
        />
    </UDropdownMenu>
</template>
