<script setup lang="ts">
/**
 * El «?» de un indicador (tablero PlanIndicadorAyuda, decisión 11 del PM): abre sin salir de la
 * pantalla la ayuda de cuatro partes (qué es, cómo se calcula, qué hacer y su nombre contable).
 * Escritorio: ventana pequeña junto al «?» (`UPopover`). Teléfono: hoja desde abajo (`UDrawer`).
 * Se cierra con Esc, con la «x» o tocando fuera; el «?» se alcanza con Tab y abre con Enter.
 * Lo usan `ContaIndicador` y los contadores de Cajas, que tienen su propio diseño.
 */
const props = defineProps<{
    clave: ClaveIndicador
}>()

const abierto = ref(false)
const telefono = ref(false)
const ayuda = computed(() => AYUDA_INDICADORES[props.clave])

onMounted(() => {
    const consulta = window.matchMedia('(max-width: 639.98px)')
    telefono.value = consulta.matches
    consulta.addEventListener('change', (e) => {
        telefono.value = e.matches
    })
})

const BOTON = {
    color: 'neutral',
    variant: 'outline',
    size: 'xs',
    label: '?',
    class: 'size-6 shrink-0 justify-center rounded-full p-0 text-xs font-bold',
} as const
</script>

<template>
    <span class="inline-flex shrink-0">
        <UPopover
            v-if="!telefono"
            v-model:open="abierto"
            :content="{ align: 'end', side: 'bottom', sideOffset: 8 }"
            :ui="{ content: 'w-80 max-w-[calc(100vw-2rem)] rounded-2xl p-4' }"
        >
            <UButton
                v-bind="BOTON"
                :aria-label="`Qué es: ${ayuda.titulo}`"
                :class="[BOTON.class, abierto ? 'bg-primary text-inverted ring-primary' : '']"
                data-prueba="indicador-ayuda"
                :data-clave="clave"
            />
            <template #content>
                <IndicadorAyudaCuerpo
                    :clave="clave"
                    @cerrar="abierto = false"
                />
            </template>
        </UPopover>
        <template v-else>
            <UButton
                v-bind="BOTON"
                :aria-label="`Qué es: ${ayuda.titulo}`"
                :class="[BOTON.class, abierto ? 'bg-primary text-inverted ring-primary' : '']"
                data-prueba="indicador-ayuda"
                :data-clave="clave"
                @click="abierto = true"
            />
            <UDrawer
                v-model:open="abierto"
                direction="bottom"
                :title="ayuda.titulo"
                description="Qué es este número y cómo leerlo"
                :ui="{ content: 'rounded-t-2xl', header: 'px-4 pt-2 pb-0', description: 'sr-only', body: 'px-4 pb-6' }"
            >
                <template #body>
                    <IndicadorAyudaCuerpo
                        :clave="clave"
                        @cerrar="abierto = false"
                    />
                </template>
            </UDrawer>
        </template>
    </span>
</template>
