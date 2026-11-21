<script setup lang="ts" generic="T extends string">
import type { TabsItem } from '@nuxt/ui'

/**
 * Pestañas segmentadas de las pantallas de Red (barra gris, activa blanca) **dentro de la tarjeta**
 * de su contenido (tableros RedRouters, RedRouterFicha, RedPlanes, RedIps, RedSesiones,
 * OperServicioFicha). Los contadores van en el `badge` de cada pestaña.
 */
defineProps<{
    items: TabsItem[]
    etiqueta: string
}>()

const valor = defineModel<T>({ required: true })
</script>

<template>
    <UTabs
        :model-value="valor"
        :items="items"
        variant="pill"
        color="neutral"
        :content="false"
        :aria-label="etiqueta"
        class="min-w-0 max-w-full"
        :ui="{
            list: 'w-auto max-w-full justify-start self-start overflow-x-auto rounded-xl bg-(--ax-panel) p-1',
            indicator: 'rounded-lg bg-(--ax-tarjeta) shadow-sm ring ring-(--ax-borde)',
            trigger: 'shrink-0 grow-0 rounded-lg px-3 text-muted data-[state=active]:text-primary',
            leadingIcon: 'size-4',
            trailingBadge: 'rounded-full',
        }"
        @update:model-value="nuevo => valor = String(nuevo) as T"
    />
</template>
