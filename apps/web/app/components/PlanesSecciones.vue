<script setup lang="ts">
import type { TabsItem } from '@nuxt/ui'

/**
 * «Planes» y «Promociones de velocidad» viven en la misma pantalla de Red › Planes (decisión del
 * PM; tablero PendPromociones): pestañas segmentadas arriba de la tarjeta, cada una con su ruta
 * (`/planes` y `/planes/promociones`). Solo aparece si el usuario puede ver las dos.
 */
const props = defineProps<{
    actual: 'planes' | 'promociones'
}>()

const { puede } = usePermisos()
const visible = computed(() => puede('planes.ver') && puede('promociones_velocidad.ver'))

const items: TabsItem[] = [
    { label: 'Planes', value: 'planes', icon: 'i-lucide-gauge' },
    { label: 'Promociones de velocidad', value: 'promociones', icon: 'i-lucide-zap' },
]

const valor = computed({
    get: () => props.actual,
    set: (nuevo: string) => {
        if (nuevo !== props.actual) {
            void navigateTo(nuevo === 'promociones' ? '/planes/promociones' : '/planes')
        }
    },
})
</script>

<template>
    <div
        v-if="visible"
        class="flex flex-wrap items-center gap-x-3 gap-y-1"
        data-prueba="secciones-planes"
    >
        <RedPestanas
            v-model="valor"
            :items="items"
            etiqueta="Planes y promociones"
        />
        <span class="hidden text-xs text-muted md:inline">Planes y promociones viven en la misma pantalla de Red › Planes</span>
    </div>
</template>
