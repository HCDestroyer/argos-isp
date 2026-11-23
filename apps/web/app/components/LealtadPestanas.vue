<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'

/**
 * Pestañas segmentadas de Lealtad (tablero OperLealtad): «Programa y premios», «Canjes» y
 * «Referidos», cada una con su ruta. Van dentro de la tarjeta de la pantalla; a la derecha, lo que
 * la pantalla ponga en `#derecha` (el interruptor del programa).
 */
const props = defineProps<{
    actual: 'programa' | 'canjes' | 'referidos'
    canjes?: number | null
    referidos?: number | null
}>()

const RUTAS = { programa: '/lealtad', canjes: '/lealtad/canjes', referidos: '/lealtad/referidos' } as const

const items = computed<TabsItem[]>(() => [
    { label: 'Programa y premios', value: 'programa', icon: 'i-lucide-star' },
    { label: 'Canjes', value: 'canjes', icon: 'i-lucide-gift', badge: props.canjes ?? undefined },
    { label: 'Referidos', value: 'referidos', icon: 'i-lucide-users', badge: props.referidos ?? undefined },
])

const valor = computed({
    get: () => props.actual,
    set: (nuevo: string | number) => {
        if (nuevo !== props.actual && nuevo in RUTAS) {
            void navigateTo(RUTAS[nuevo as keyof typeof RUTAS])
        }
    },
})
</script>

<template>
    <div class="flex flex-wrap items-center justify-between gap-3 border-b border-(--ax-borde) p-3 sm:p-4">
        <OperPestanas
            v-model="valor"
            :items="items"
            etiqueta="Lealtad"
            class="w-auto"
        />
        <slot name="derecha" />
    </div>
</template>
