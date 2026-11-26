<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Una promoción de velocidad en su página (tablero PendPromocionesMovil, pantalla `det`; también
 * la abren las pantallas de menos de 1280 px desde la lista): el mismo detalle que la columna
 * derecha de Red › Planes › Promociones de velocidad. En el teléfono «Cancelar» y «Asignar
 * servicios» van fijos abajo.
 */
definePageMeta({ permiso: 'promociones_velocidad.ver' })

const route = useRoute()
const promocionId = computed(() => Number(route.params.id))
const promocion = shallowRef<PromocionVelocidad | null>(null)
const cargando = ref(true)
const problema = ref<Problem | null>(null)
const detalle = ref<{ abrirAsignar: () => void, abrirCancelar: () => void, puedeAsignar: boolean, puedeCancelar: boolean } | null>(null)

useHead(() => ({ title: `${promocion.value?.nombre ?? 'Promoción de velocidad'} · ArgosIsp` }))

async function cargar() {
    cargando.value = true
    problema.value = null
    const resultado = await usePromocionesVelocidad().ver(promocionId.value)
    cargando.value = false
    promocion.value = resultado.ok ? resultado.data : null
    problema.value = resultado.ok ? null : resultado.problema
}

watch(promocionId, () => void cargar())
onMounted(cargar)
</script>

<template>
    <PanelPagina
        id="promocion-velocidad"
        titulo="Promociones de velocidad"
        icono="i-lucide-zap"
    >
        <template #acciones>
            <UButton
                to="/planes/promociones"
                label="Promociones"
                icon="i-lucide-chevron-left"
                color="neutral"
                variant="ghost"
                class="rounded-full"
            />
        </template>

        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="cargando && !promocion"
            class="h-96 w-full rounded-[1.375rem]"
        />
        <div
            v-else-if="promocion"
            class="surface-card flex min-w-0 flex-col overflow-clip rounded-2xl lg:max-w-3xl"
        >
            <PromocionDetalle
                ref="detalle"
                :promocion="promocion"
                class="max-sm:[&>footer]:hidden"
                @cambiada="cargar"
            />
        </div>

        <RedBarraTelefono v-if="promocion && detalle && (detalle.puedeAsignar || detalle.puedeCancelar)">
            <UButton
                v-if="detalle.puedeCancelar"
                label="Cancelar"
                color="error"
                variant="outline"
                size="lg"
                class="rounded-full"
                @click="detalle.abrirCancelar()"
            />
            <UButton
                v-if="detalle.puedeAsignar"
                label="Asignar servicios"
                icon="i-lucide-plus"
                size="lg"
                class="flex-1 justify-center rounded-full"
                @click="detalle.abrirAsignar()"
            />
        </RedBarraTelefono>
    </PanelPagina>
</template>
