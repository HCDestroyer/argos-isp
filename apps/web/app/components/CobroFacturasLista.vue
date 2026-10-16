<script setup lang="ts">
import type { Schema } from '@argosisp/contracts'

type Factura = Schema<'Factura'>

/**
 * Facturas pendientes de un cliente en `/cobro`, con casilla para elegir cuáles paga. Las
 * marcadas se aplican en el orden de la pantalla (`facturas[]` de `POST /pagos`).
 */
const props = withDefaults(defineProps<{
    facturas: Factura[]
    marcadas: number[]
    /** Usuario PPP de cada servicio, para nombrar el servicio de cada factura. */
    servicios?: Map<number, string>
    etiqueta?: string
}>(), {
    servicios: () => new Map(),
    etiqueta: 'Facturas pendientes',
})

const emit = defineEmits<{
    marcar: [facturaId: number, valor: boolean]
}>()

const hoy = hoyGuatemala()

function servicioDe(factura: Factura): string | null {
    if (factura.servicio_id === null) {
        return null
    }
    return props.servicios.get(factura.servicio_id) ?? `servicio ${factura.servicio_id}`
}
</script>

<template>
    <ul
        class="flex flex-col divide-y divide-default rounded-md border border-default"
        :aria-label="etiqueta"
    >
        <li
            v-for="factura in facturas"
            :key="factura.id"
            class="flex items-start gap-3 px-3 py-2 text-sm"
            :class="facturaVencida(factura, hoy) ? 'border-l-2 border-l-error' : ''"
            :data-factura="factura.id"
        >
            <UCheckbox
                :model-value="marcadas.includes(factura.id)"
                :aria-label="`Pagar el aviso ${factura.id}`"
                class="mt-0.5"
                @update:model-value="emit('marcar', factura.id, $event === true)"
            />
            <div class="flex min-w-0 flex-1 flex-col">
                <span class="text-highlighted">
                    Aviso #{{ factura.id }} · {{ etiquetaPeriodo(factura.periodo) }}
                </span>
                <span class="text-xs text-muted">
                    <template v-if="servicioDe(factura)">{{ servicioDe(factura) }} · </template>Vence {{ formatearFecha(factura.vence_en) }} · total {{ formatearQuetzales(factura.total) }}
                </span>
            </div>
            <div class="flex shrink-0 flex-col items-end gap-1">
                <span class="font-medium tabular-nums text-highlighted">{{ formatearQuetzales(saldoFactura(factura)) }}</span>
                <UBadge
                    :label="facturaVencida(factura, hoy) ? 'Vencida' : ESTADOS_FACTURA[factura.estado].etiqueta"
                    :color="facturaVencida(factura, hoy) ? 'error' : ESTADOS_FACTURA[factura.estado].color"
                    variant="subtle"
                    size="sm"
                />
            </div>
        </li>
    </ul>
</template>
