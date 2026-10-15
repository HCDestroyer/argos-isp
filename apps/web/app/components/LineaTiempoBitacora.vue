<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'
import type { TimelineItem } from '@nuxt/ui'

/**
 * Línea de tiempo de la bitácora, de lo más reciente a lo más viejo, con los filtros de
 * `GET /bitacora/acciones`: `{ cliente_id, excluir_canal: 'portal' }` en la ficha del cliente
 * (la API junta el cliente y sus servicios, facturas, pagos y promesas) o
 * `{ entidad_tipo: 'servicio', entidad_id }` en la del servicio. Cada entrada dice quién
 * (`actor_nombre`), por qué canal y con qué resultado. "Ver más" sigue el cursor.
 */
const props = withDefaults(defineProps<{
    filtros: Omit<FiltrosAcciones, 'limit'>
    etiqueta?: string
    /** Entradas por página. */
    limite?: number
}>(), {
    etiqueta: 'Línea de tiempo',
    limite: 50,
})

defineExpose({ recargar: () => cargar() })

/** El tema pinta el indicador con `group-data-[state=completed]:bg-primary`; hay que pisar esa misma variante. */
const INDICADOR_ERROR = 'group-data-[state=completed]:bg-error group-data-[state=active]:bg-error'

interface EntradaLinea extends TimelineItem {
    accion: AccionAuditoria
}

const acciones = shallowRef<AccionAuditoria[]>([])
const cargando = ref(true)
const cargandoMas = ref(false)
const problema = ref<Problem | null>(null)
const siguienteCursor = ref<string | null>(null)

/** Evita que una respuesta vieja pise a la de otros filtros. */
let solicitud = 0

const items = computed<EntradaLinea[]>(() => acciones.value.filter(visibleEnLineaTiempo).map(accion => ({
    date: formatearFechaHora(accion.created_at),
    title: tituloAccion(accion),
    icon: iconoAccion(accion),
    accion,
    ui: accion.resultado === 'error' ? { indicator: INDICADOR_ERROR } : undefined,
})))

async function cargar() {
    const actual = ++solicitud
    cargando.value = true
    const resultado = await useBitacora().acciones({ ...props.filtros, limit: props.limite })
    if (actual !== solicitud) {
        return
    }
    cargando.value = false
    if (resultado.ok) {
        acciones.value = resultado.data.data
        siguienteCursor.value = resultado.data.nextCursor || null
        problema.value = null
    }
    else {
        acciones.value = []
        siguienteCursor.value = null
        problema.value = resultado.problema
    }
}

async function verMas() {
    const cursor = siguienteCursor.value
    if (!cursor || cargandoMas.value) {
        return
    }
    const actual = solicitud
    cargandoMas.value = true
    const resultado = await useBitacora().acciones({ ...props.filtros, limit: props.limite }, cursor)
    cargandoMas.value = false
    if (actual !== solicitud) {
        return
    }
    if (resultado.ok) {
        const vistas = new Set(acciones.value.map(a => a.id))
        acciones.value = [...acciones.value, ...resultado.data.data.filter(a => !vistas.has(a.id))]
        siguienteCursor.value = resultado.data.nextCursor || null
    }
    else {
        problema.value = resultado.problema
    }
}

watch(() => JSON.stringify(props.filtros), cargar)
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
            v-else-if="!problema && !items.length && !siguienteCursor"
            icon="i-lucide-scroll-text"
            title="Sin actividad registrada"
            variant="naked"
        />

        <template v-else-if="!problema">
            <UTimeline
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
                            v-if="motivoAccion(item.accion)"
                            class="text-xs text-default"
                        >
                            Motivo: {{ motivoAccion(item.accion) }}
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

            <UButton
                v-if="siguienteCursor"
                label="Ver más"
                icon="i-lucide-chevrons-down"
                color="neutral"
                variant="outline"
                size="sm"
                class="self-start"
                :loading="cargandoMas"
                @click="verMas"
            />
        </template>
    </div>
</template>
