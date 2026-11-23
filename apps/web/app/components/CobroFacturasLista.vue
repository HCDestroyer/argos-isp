<script setup lang="ts">
import type { Schema } from '@argosisp/contracts'

type Factura = Schema<'Factura'>

/**
 * Facturas pendientes con casilla para elegir cuáles paga (tablero NuevoCobro): mes, aviso y
 * vencimiento, estado y saldo. Las marcadas se aplican en el orden de la pantalla (`facturas[]`
 * de `POST /pagos`). Toda la fila marca o desmarca.
 */
const props = withDefaults(defineProps<{
    facturas: Factura[]
    marcadas: number[]
    /** Nombre de cada servicio, para nombrar el servicio de cada factura (cuando no van agrupadas). */
    servicios?: Map<number, string>
    etiqueta?: string
    /** Las facturas ya van bajo el encabezado de su servicio: no se repite el nombre. */
    agrupadas?: boolean
}>(), {
    servicios: () => new Map(),
    etiqueta: 'Facturas pendientes',
    agrupadas: false,
})

const emit = defineEmits<{
    marcar: [facturaId: number, valor: boolean]
}>()

const hoy = hoyGuatemala()

function servicioDe(factura: Factura): string | null {
    if (props.agrupadas || factura.servicio_id === null) {
        return null
    }
    return props.servicios.get(factura.servicio_id) ?? `servicio ${factura.servicio_id}`
}

function titulo(factura: Factura): string {
    const periodo = etiquetaPeriodo(factura.periodo)
    return periodo.charAt(0).toUpperCase() + periodo.slice(1)
}

function vence(factura: Factura): string {
    return `${facturaVencida(factura, hoy) ? 'venció' : 'vence'} ${formatearFechaCorta(factura.vence_en)}`
}

function alternar(factura: Factura) {
    emit('marcar', factura.id, !props.marcadas.includes(factura.id))
}
</script>

<template>
    <ul
        class="flex flex-col divide-y divide-(--ax-borde)"
        :aria-label="etiqueta"
    >
        <li
            v-for="factura in facturas"
            :key="factura.id"
            class="flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-(--ax-fila-hover)"
            :class="marcadas.includes(factura.id) ? 'bg-primary/5' : ''"
            :data-factura="factura.id"
            data-clicable
            @click="alternar(factura)"
        >
            <UCheckbox
                :model-value="marcadas.includes(factura.id)"
                :aria-label="`Pagar ${titulo(factura).toLowerCase()} (aviso ${factura.id})`"
                size="lg"
                @click.stop
                @update:model-value="emit('marcar', factura.id, $event === true)"
            />
            <div class="flex min-w-0 flex-1 flex-col">
                <span class="truncate text-[0.9375rem] font-semibold text-highlighted">{{ titulo(factura) }}</span>
                <span class="truncate text-xs text-muted">
                    A-{{ factura.id }} · {{ vence(factura) }}<template v-if="servicioDe(factura)"> · {{ servicioDe(factura) }}</template>
                </span>
            </div>
            <UBadge
                :label="facturaVencida(factura, hoy) ? 'Vencida' : factura.estado === 'emitida' ? 'Por vencer' : ESTADOS_FACTURA[factura.estado].etiqueta"
                :icon="facturaVencida(factura, hoy) ? ESTADOS_FACTURA.vencida.icono : 'i-lucide-clock'"
                :color="facturaVencida(factura, hoy) ? 'error' : 'neutral'"
                variant="subtle"
                size="sm"
                class="shrink-0 rounded-full"
            />
            <span class="w-24 shrink-0 text-end text-[0.9375rem] font-bold tabular-nums text-highlighted">{{ formatearQuetzales(saldoFactura(factura)) }}</span>
        </li>
    </ul>
</template>
