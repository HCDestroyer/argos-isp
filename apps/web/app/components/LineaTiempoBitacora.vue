<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TimelineItem } from '@nuxt/ui'

/**
 * Línea de tiempo de la bitácora de una o varias entidades (el cliente y sus servicios, o un
 * servicio), de lo más reciente a lo más viejo. Cada entrada dice quién, por qué canal y con
 * qué resultado. Oculta las lecturas del portal (`visibleEnLineaTiempo`).
 */
const props = withDefaults(defineProps<{
    entidades: EntidadAuditada[]
    etiqueta?: string
}>(), {
    etiqueta: 'Línea de tiempo',
})

defineExpose({ recargar: () => cargar() })

/** El tema pinta el indicador con `group-data-[state=completed]:bg-primary`; hay que pisar esa misma variante. */
const INDICADOR_ERROR = 'group-data-[state=completed]:bg-error group-data-[state=active]:bg-error'

interface EntradaLinea extends TimelineItem {
    accion: AccionAuditoria
}

const acciones = shallowRef<AccionAuditoria[]>([])
const cargando = ref(true)
const problema = ref<Problem | null>(null)

/**
 * Cuántas entradas se piden por entidad. Alto a propósito: la API no filtra por cliente ni
 * excluye lecturas (pedido a A1), y las visitas a `/corte` (`portal.quien_soy`) se cuelan
 * entre las acciones que sí importan.
 */
const LIMITE_POR_ENTIDAD = 200

const items = computed<EntradaLinea[]>(() => acciones.value.filter(visibleEnLineaTiempo).map(accion => ({
    date: formatearFechaHora(accion.created_at),
    title: tituloAccion(accion),
    icon: iconoAccion(accion),
    accion,
    ui: accion.resultado === 'error' ? { indicator: INDICADOR_ERROR } : undefined,
})))

async function cargar() {
    cargando.value = true
    const resultado = await useBitacora().deEntidades(props.entidades, LIMITE_POR_ENTIDAD)
    cargando.value = false
    if (resultado.ok) {
        acciones.value = resultado.data
        problema.value = null
    }
    else {
        problema.value = resultado.problema
    }
}

watch(() => props.entidades.map(e => `${e.tipo}:${e.id}`).join(','), cargar)
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
            v-else-if="!problema"
            :items="items"
            :default-value="items.length"
            :aria-label="etiqueta"
            size="sm"
            class="max-w-2xl"
        >
            <template #description="{ item }">
                <div class="flex flex-col gap-1">
                    <span class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                        <span>{{ etiquetaActor(item.accion) }}</span>
                        <span aria-hidden="true">·</span>
                        <UBadge
                            :label="etiquetaCanal(item.accion.canal)"
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
