<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'

/**
 * Pestañas segmentadas del área de operación (sistema visual, tableros Oper*): barra gris con la
 * activa en blanco, siempre dentro de la misma tarjeta que su contenido. Cada ítem puede llevar
 * icono y contador (`badge`). Solo cambia el valor; el contenido lo pinta la pantalla.
 */
defineProps<{
    items: TabsItem[]
    /** Nombre accesible de la lista de pestañas. */
    etiqueta?: string
}>()

const valor = defineModel<string | number>({ required: true })
</script>

<template>
    <UTabs
        v-model="valor"
        :items="items"
        variant="pill"
        color="neutral"
        :content="false"
        :aria-label="etiqueta"
        class="w-full min-w-0"
        :ui="{
            list: 'w-auto max-w-full justify-start self-start overflow-x-auto rounded-xl bg-(--ax-panel) p-1',
            indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
            trigger: 'shrink-0 grow-0 rounded-lg px-3 text-muted data-[state=active]:text-primary',
            leadingIcon: 'size-4',
            trailingBadge: 'tabular-nums',
        }"
    />
</template>
