<script setup lang="ts">
import Decimal from 'decimal.js'

/**
 * Lo que cubre una promesa creada ahora (decisión del PM, 29 oct: todo lo vencido, sin monto
 * escrito): las facturas vencidas con su saldo, el total, el abono inicial requerido y lo ya
 * abonado, y el último día en que puede vencer. Todo viene de `POST /promesas/simular`; quien lo
 * usa no lo muestra si la simulación falló.
 */
const props = defineProps<{
    cobertura: CoberturaPromesa
}>()

const exigeAbono = computed(() => new Decimal(props.cobertura.abonoRequerido).gt(0))
const faltaAbono = computed(() => new Decimal(props.cobertura.abonoFalta).gt(0))
</script>

<template>
    <section
        class="flex flex-col gap-3 rounded-lg border border-default p-3 sm:p-4"
        aria-label="Lo que cubre la promesa"
        data-prueba="cobertura"
    >
        <p
            v-if="cobertura.sinVencido"
            class="flex items-start gap-2 text-sm text-muted"
            data-prueba="cobertura-sin-vencido"
        >
            <UIcon
                name="i-lucide-circle-check"
                class="mt-0.5 size-4 shrink-0 text-success"
            />
            <span>El servicio no tiene facturas vencidas: no hay nada que prometer.</span>
        </p>

        <template v-else>
            <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span class="text-sm text-muted">
                    Cubre todo lo vencido<template v-if="cobertura.facturas"> · {{ textoFacturas(cobertura.facturas.length) }}</template>
                </span>
                <span
                    class="text-base font-semibold tabular-nums text-highlighted"
                    data-prueba="cobertura-total"
                >{{ formatearQuetzales(cobertura.monto) }}</span>
            </div>

            <ul
                v-if="cobertura.facturas?.length"
                class="flex flex-col divide-y divide-default rounded-md bg-elevated/50"
                aria-label="Facturas que cubre"
                data-prueba="cobertura-facturas"
            >
                <li
                    v-for="factura in cobertura.facturas"
                    :key="factura.factura_id"
                    class="flex items-start justify-between gap-3 px-3 py-2 text-sm"
                    data-prueba="factura-cubierta"
                    :data-factura="factura.factura_id"
                >
                    <span class="flex min-w-0 flex-col">
                        <span class="text-highlighted">{{ etiquetaFacturaCubierta(factura) }}</span>
                        <span class="text-xs text-muted">Factura #{{ factura.factura_id }} · venció {{ formatearFecha(factura.vence_en) }}</span>
                    </span>
                    <span class="shrink-0 tabular-nums text-default">{{ formatearQuetzales(factura.monto) }}</span>
                </li>
            </ul>
        </template>

        <dl class="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
            <DatoFicha
                etiqueta="Abono inicial requerido"
                :valor="exigeAbono ? formatearQuetzales(cobertura.abonoRequerido) : 'No se exige'"
                data-prueba="abono-requerido"
            />
            <DatoFicha
                etiqueta="Ya abonado"
                :valor="formatearQuetzales(cobertura.abonoPagado)"
                data-prueba="abono-pagado"
            />
            <DatoFicha
                etiqueta="Último día posible"
                :valor="formatearFecha(cobertura.fechaMaxima)"
                data-prueba="fecha-maxima"
            />
        </dl>

        <UAlert
            v-if="faltaAbono"
            color="warning"
            variant="subtle"
            icon="i-lucide-hand-coins"
            :title="`Falta abonar ${formatearQuetzales(cobertura.abonoFalta)}`"
            description="El abono inicial se exige antes de prometer; la promesa cubre lo que queda vencido después del abono."
            data-prueba="abono-falta"
        />
    </section>
</template>
