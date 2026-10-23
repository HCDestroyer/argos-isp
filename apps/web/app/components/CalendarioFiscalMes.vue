<script setup lang="ts">
/**
 * Cuadrícula de un mes del calendario fiscal (de lunes a domingo). Cada día lleva las obligaciones
 * que vencen en él: en escritorio como botones con el impuesto (vencidas en rojo, presentadas en
 * verde, las que no aplican atenuadas); en el teléfono como puntos de color, y la agenda del mes
 * (en la página) lleva el detalle. Los feriados vigentes del mes se marcan con su nombre.
 */
const props = withDefaults(defineProps<{
    mes: string
    hoy: string
    obligaciones: ObligacionFiscal[]
    /** Fecha → nombre del feriado vigente. */
    feriados?: Record<string, string>
    /** Muestra la empresa de cada obligación (consolidado). */
    empresa?: (id: number) => string
}>(), {
    feriados: () => ({}),
    empresa: undefined,
})

const emit = defineEmits<{ elegir: [obligacion: ObligacionFiscal] }>()

const semanas = computed(() => semanasDelMes(props.mes))

const porFecha = computed(() => {
    const mapa = new Map<string, ObligacionFiscal[]>()
    for (const obligacion of props.obligaciones) {
        mapa.set(obligacion.vence_en, [...(mapa.get(obligacion.vence_en) ?? []), obligacion])
    }
    return mapa
})

const COLOR_PUNTO: Record<string, string> = {
    error: 'bg-error',
    warning: 'bg-warning',
    info: 'bg-info',
    success: 'bg-success',
    neutral: 'bg-muted',
}

function puntoDe(obligacion: ObligacionFiscal): string {
    return COLOR_PUNTO[estadoVisible(obligacion).color] ?? 'bg-muted'
}

function etiquetaDe(obligacion: ObligacionFiscal): string {
    const estado = estadoVisible(obligacion).etiqueta
    const motivo = motivoObligacion(obligacion.motivo_estado)
    const empresa = props.empresa ? ` · ${props.empresa(obligacion.empresa_id)}` : ''
    return `${obligacion.nombre}, ${periodoObligacion(obligacion)}${empresa}: ${estado}${motivo ? ` (${motivo})` : ''}`
}
</script>

<template>
    <div
        class="overflow-hidden rounded-lg border border-default"
        data-prueba="calendario-mes"
    >
        <div
            class="grid grid-cols-7 border-b border-default bg-elevated/50 text-center text-xs font-medium text-muted"
            aria-hidden="true"
        >
            <div
                v-for="dia in DIAS_SEMANA"
                :key="dia.largo"
                class="py-2"
            >
                <span class="sm:hidden">{{ dia.corto }}</span>
                <span class="hidden sm:inline">{{ dia.largo.slice(0, 3) }}</span>
            </div>
        </div>
        <div
            v-for="(semana, i) in semanas"
            :key="i"
            class="grid grid-cols-7 border-b border-default last:border-b-0"
        >
            <div
                v-for="dia in semana"
                :key="dia.fecha"
                class="flex min-h-14 min-w-0 flex-col gap-1 border-r border-default p-1 last:border-r-0 sm:min-h-24 sm:p-1.5"
                :class="{
                    'bg-elevated/40': !dia.delMes || dia.finDeSemana || feriados[dia.fecha],
                    'ring-2 ring-inset ring-primary': dia.fecha === hoy,
                }"
                :data-fecha="dia.fecha"
            >
                <div class="flex items-center justify-between gap-1">
                    <span
                        class="text-xs tabular-nums"
                        :class="dia.delMes ? (dia.fecha === hoy ? 'font-semibold text-primary' : 'text-highlighted') : 'text-dimmed'"
                    >{{ dia.dia }}</span>
                    <UIcon
                        v-if="feriados[dia.fecha]"
                        name="i-lucide-flag"
                        class="size-3 shrink-0 text-muted"
                        :aria-label="`Feriado: ${feriados[dia.fecha]}`"
                    />
                </div>
                <span
                    v-if="feriados[dia.fecha]"
                    class="hidden truncate text-[11px] leading-tight text-muted sm:block"
                    data-prueba="calendario-feriado"
                >{{ feriados[dia.fecha] }}</span>
                <!-- Teléfono: puntos de color; el detalle va en la agenda del mes. -->
                <div
                    v-if="porFecha.get(dia.fecha)?.length"
                    class="flex flex-wrap gap-1 sm:hidden"
                    role="img"
                    :aria-label="(porFecha.get(dia.fecha) ?? []).map(etiquetaDe).join('; ')"
                >
                    <span
                        v-for="obligacion in porFecha.get(dia.fecha)"
                        :key="obligacion.id"
                        class="size-2 rounded-full"
                        :class="[puntoDe(obligacion), obligacion.estado === 'no_aplica' ? 'opacity-50' : '']"
                    />
                </div>
                <div class="hidden min-w-0 flex-col gap-1 sm:flex">
                    <UButton
                        v-for="obligacion in porFecha.get(dia.fecha)"
                        :key="obligacion.id"
                        :label="IMPUESTOS_OBLIGACION[obligacion.impuesto].etiqueta"
                        :icon="estadoVisible(obligacion).icono"
                        :color="estadoVisible(obligacion).color"
                        :variant="obligacion.estado === 'presentada' ? 'outline' : 'soft'"
                        size="xs"
                        block
                        class="justify-start"
                        :class="{ 'line-through decoration-1': obligacion.estado === 'no_aplica' }"
                        :ui="{ label: 'truncate' }"
                        :aria-label="etiquetaDe(obligacion)"
                        :title="etiquetaDe(obligacion)"
                        :data-obligacion="obligacion.id"
                        :data-estado="obligacion.vencida ? 'vencida' : obligacion.estado"
                        :data-rectificativa="esRectificativa(obligacion) ? 'si' : undefined"
                        @click="emit('elegir', obligacion)"
                    />
                </div>
            </div>
        </div>
    </div>
</template>
