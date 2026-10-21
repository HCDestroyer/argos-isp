<script setup lang="ts">
import type { Problem } from '@argosisp/contracts'

/**
 * Periodos bonificados de un cliente o de un servicio (A3, decisión del PM: lo que antes era una
 * factura de Q0). Cada fila: el mes (o la fecha de un cargo sin costo), el concepto, el origen, el
 * motivo y el valor bruto regalado, con enlace a su ficha. Quien lo abre ya comprobó `facturas.ver`.
 */
const props = defineProps<{
    clienteId?: number
    servicioId?: number
}>()

const { enlace } = usePermisos()
const filas = shallowRef<Bonificacion[]>([])
const hayMas = ref(false)
const cargando = ref(true)
const problema = ref<Problem | null>(null)

const verTodas = computed(() => (props.servicioId ? `/bonificaciones?servicio=${props.servicioId}` : `/bonificaciones?cliente=${props.clienteId ?? ''}`))

async function cargar() {
    cargando.value = true
    const filtros: FiltrosBonificaciones = { limit: 6 }
    if (props.servicioId) {
        filtros.servicio_id = props.servicioId
    }
    else if (props.clienteId) {
        filtros.cliente_id = props.clienteId
    }
    const resultado = await useBonificaciones().listar(filtros)
    cargando.value = false
    filas.value = resultado.ok ? resultado.data.data : []
    hayMas.value = resultado.ok && resultado.data.nextCursor !== null
    problema.value = resultado.ok ? null : resultado.problema
}

watch(() => [props.clienteId, props.servicioId], () => void cargar(), { immediate: true })

defineExpose({ recargar: cargar })
</script>

<template>
    <section
        class="flex flex-col gap-3"
        aria-label="Periodos bonificados"
        data-prueba="periodos-bonificados"
    >
        <div class="flex items-center justify-between gap-2">
            <h3 class="text-sm font-semibold text-highlighted">
                Periodos bonificados
            </h3>
            <UButton
                v-if="hayMas"
                :to="enlace(verTodas)"
                label="Ver todas"
                color="neutral"
                variant="link"
                size="sm"
                trailing-icon="i-lucide-arrow-right"
            />
        </div>
        <ProblemaAlerta
            v-if="problema"
            :problema="problema"
            :reintentar="cargar"
            :reintentando="cargando"
        />
        <USkeleton
            v-else-if="cargando && !filas.length"
            class="h-14 w-full"
        />
        <p
            v-else-if="!filas.length"
            class="text-sm text-muted"
        >
            Sin periodos bonificados.
        </p>
        <ul
            v-else
            class="flex flex-col divide-y divide-default rounded-lg border border-default"
        >
            <li
                v-for="b in filas"
                :key="b.id"
                class="flex flex-col gap-1 p-3 sm:flex-row sm:items-center sm:justify-between"
                :data-bonificacion="b.id"
            >
                <div class="flex min-w-0 flex-col gap-0.5">
                    <div class="flex flex-wrap items-center gap-2">
                        <ULink
                            :to="enlace(`/bonificaciones/${b.id}`)"
                            class="text-sm font-medium text-highlighted hover:text-primary"
                        >
                            {{ ocupaPeriodo(b) ? `Periodo de ${periodoBonificacion(b)}` : `Cargo del ${periodoBonificacion(b)}` }}
                        </ULink>
                        <UBadge
                            :label="origenBonificacionVisual(b.origen).etiqueta"
                            :icon="origenBonificacionVisual(b.origen).icono"
                            :color="origenBonificacionVisual(b.origen).color"
                            variant="subtle"
                            size="sm"
                        />
                    </div>
                    <span class="text-xs text-muted">{{ b.concepto }} · {{ b.motivo_nombre }}</span>
                </div>
                <span class="text-sm tabular-nums text-muted">
                    <span class="text-highlighted">{{ formatearQuetzales(b.bruto) }}</span> sin cobrar
                </span>
            </li>
        </ul>
    </section>
</template>
