<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TimelineItem } from '@nuxt/ui'

/**
 * Pestaña "Línea de tiempo": bitácora del cliente y de sus servicios, de lo más reciente a lo
 * más viejo. Cada entrada dice quién, por qué canal y con qué resultado.
 */
const props = withDefaults(defineProps<{
    clienteId: number
    servicioIds?: number[]
}>(), {
    servicioIds: () => [],
})

/** El tema pinta el indicador con `group-data-[state=completed]:bg-primary`; hay que pisar esa misma variante. */
const INDICADOR_ERROR = 'group-data-[state=completed]:bg-error group-data-[state=active]:bg-error'

interface EntradaLinea extends TimelineItem {
    accion: AccionAuditoria
}

const acciones = shallowRef<AccionAuditoria[]>([])
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const items = computed<EntradaLinea[]>(() => acciones.value.map(accion => ({
    date: formatearFechaHora(accion.created_at),
    title: etiquetaAccion(accion.accion),
    icon: iconoAccion(accion),
    accion,
    ui: accion.resultado === 'error' ? { indicator: INDICADOR_ERROR } : undefined,
})))

async function cargar() {
    cargando.value = true
    const resultado = await useBitacora().deEntidades([
        { tipo: 'cliente', id: props.clienteId },
        ...props.servicioIds.map(id => ({ tipo: 'servicio', id })),
    ])
    cargando.value = false
    if (resultado.ok) {
        acciones.value = resultado.data
        problema.value = null
    }
    else {
        problema.value = resultado.problema
    }
}

watch(() => props.servicioIds.join(','), cargar)
onMounted(cargar)
</script>

<template>
    <div class="flex flex-col gap-4">
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
        />

        <div
            v-if="cargando"
            class="flex flex-col gap-4"
        >
            <USkeleton
                v-for="n in 4"
                :key="n"
                class="h-12 w-full max-w-lg"
            />
        </div>

        <UEmpty
            v-else-if="!problema && !items.length"
            icon="i-lucide-scroll-text"
            title="Sin actividad registrada"
            variant="naked"
        />

        <UTimeline
            v-else
            :items="items"
            :default-value="items.length"
            aria-label="Línea de tiempo del cliente"
            size="sm"
            class="max-w-2xl"
        >
            <template #description="{ item }">
                <div class="flex flex-col gap-1">
                    <span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <span>{{ etiquetaActor(item.accion) }}</span>
                        <span aria-hidden="true">·</span>
                        <UBadge
                            :label="item.accion.canal"
                            color="neutral"
                            variant="outline"
                            size="sm"
                        />
                        <template v-if="etiquetaEntidad(item.accion)">
                            <span aria-hidden="true">·</span>
                            <span>{{ etiquetaEntidad(item.accion) }}</span>
                        </template>
                    </span>
                    <span
                        v-if="item.accion.resultado === 'error'"
                        class="text-xs text-error"
                    >
                        Falló: {{ item.accion.error ?? 'sin detalle' }}
                    </span>
                </div>
            </template>
        </UTimeline>
    </div>
</template>
