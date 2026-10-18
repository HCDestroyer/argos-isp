<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/** Detalle de un DTE (`GET /dte/:id`, `fel.ver`) con reintentar, XML y PDF. */
definePageMeta({ permiso: 'fel.ver' })

const route = useRoute()
const dteId = computed(() => Number(route.params.id))

const dte = shallowRef<Dte | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

useHead(() => ({ title: `DTE #${route.params.id} · ArgosIsp` }))

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await useDte().ver(dteId.value)
    cargando.value = false
    dte.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

/** Un rechazado reintentado es otro DTE: se navega a él. */
function alActualizar(nuevo: Dte) {
    if (nuevo.id !== dteId.value) {
        void navigateTo(`/dte/${nuevo.id}`)
        return
    }
    dte.value = nuevo
}

watch(dteId, cargar)
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="dte-detalle"
        :titulo="`DTE #${route.params.id}`"
        icono="i-lucide-badge-check"
    >
        <template #acciones>
            <UButton
                to="/dte"
                icon="i-lucide-arrow-left"
                label="Cola de DTE"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <USkeleton
            v-if="cargando && !dte"
            class="h-48 w-full"
        />
        <UEmpty
            v-else-if="problema?.status === 404"
            icon="i-lucide-file-x"
            title="DTE no encontrado"
            :description="`No existe un DTE con id ${route.params.id}.`"
            :actions="[{ label: 'Volver a la cola', to: '/dte', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
        />
        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <UPageCard
            v-else-if="dte"
            variant="subtle"
        >
            <DteFicha
                :dte="dte"
                con-documento
                @actualizado="alActualizar"
            />
        </UPageCard>
    </PanelPagina>
</template>
