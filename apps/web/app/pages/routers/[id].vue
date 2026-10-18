<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Ficha corta del router: destino del autologin desde Horus (`/routers/:id`, `rutaDestino` de A1)
 * y acceso a "Ver en Horus". La velocidad y la conexión se cambian desde la lista de routers.
 */
definePageMeta({ permiso: 'routers.ver' })

const route = useRoute()
const routerId = computed(() => Number(route.params.id))

const nas = shallowRef<RouterNas | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

useHead(() => ({ title: `${nas.value?.nombre ?? 'Router'} · ArgosIsp` }))

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = Number.isInteger(routerId.value) && routerId.value > 0
        ? await useRouters().ver(routerId.value)
        : null
    cargando.value = false
    nas.value = resultado?.ok ? resultado.data : null
    problema.value = resultado && !resultado.ok ? resultado.problema : null
}

onMounted(cargar)

const control = computed(() => {
    const actual = nas.value
    if (!actual) {
        return null
    }
    return CONTROLES_VELOCIDAD[actual.control_velocidad ?? (actual.modo_velocidad === 'pcq' ? 'arbol_pcq' : 'simple')]
})
</script>

<template>
    <PanelPagina
        id="router"
        :titulo="nas?.nombre ?? 'Router'"
        icono="i-lucide-router"
    >
        <template #acciones>
            <VerEnHorusBoton
                v-if="nas"
                tipo="router"
                :id-externo="nas.id"
            />
            <UButton
                to="/routers"
                icon="i-lucide-arrow-left"
                label="Routers"
                color="neutral"
                variant="ghost"
                class="hidden sm:inline-flex"
            />
        </template>

        <USkeleton
            v-if="cargando"
            class="h-40 w-full"
        />
        <UEmpty
            v-else-if="problema?.status === 404 || (!problema && !nas)"
            icon="i-lucide-router"
            title="Router no encontrado"
            :description="`No existe un router con id ${route.params.id}.`"
            :actions="[{ label: 'Volver a routers', to: '/routers', icon: 'i-lucide-arrow-left', color: 'neutral', variant: 'subtle' }]"
        />
        <ProblemaAlerta
            v-else-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <section
            v-else-if="nas"
            class="surface-card mx-auto w-full max-w-4xl p-4 sm:p-6"
            aria-label="Datos del router"
        >
            <dl class="grid gap-4 sm:grid-cols-3">
                <DatoFicha
                    etiqueta="Host"
                    :valor="nas.host"
                    mono
                />
                <DatoFicha
                    etiqueta="NAS"
                    :valor="nas.nas_ip"
                    mono
                />
                <DatoFicha etiqueta="Estado">
                    <UBadge
                        :label="nas.activo ? 'Activo' : 'Inactivo'"
                        :icon="nas.activo ? 'i-lucide-circle-check' : 'i-lucide-circle-pause'"
                        :color="nas.activo ? 'success' : 'neutral'"
                        variant="subtle"
                        size="sm"
                    />
                </DatoFicha>
                <DatoFicha
                    v-if="control"
                    etiqueta="Colas"
                    :valor="control.etiqueta"
                />
            </dl>
        </section>
    </PanelPagina>
</template>
