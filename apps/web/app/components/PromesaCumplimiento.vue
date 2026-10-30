<script setup lang="ts">
import Decimal from 'decimal.js'

/**
 * Cómo se cumple una promesa guardada (`regla_cumplimiento` de A3, tal como la devuelve la API) y,
 * con la regla `facturas`, las facturas que cubre con su saldo al crearla y hoy. Si la API no trae
 * la regla (transición del OpenAPI), no se muestra nada: no se deduce.
 */
const props = withDefaults(defineProps<{
    promesa: Promesa
    /** Una sola línea, para filas de tabla. */
    compacta?: boolean
}>(), {
    compacta: false,
})

const regla = computed(() => (props.promesa.regla_cumplimiento ? REGLAS_CUMPLIMIENTO[props.promesa.regla_cumplimiento] : null))
const facturas = computed(() => (props.promesa.regla_cumplimiento === 'facturas' ? (props.promesa.facturas ?? []) : []))
const resumen = computed(() => resumenCumplimiento(props.promesa))

function saldada(factura: FacturaPromesa): boolean {
    return !new Decimal(factura.saldo).gt(0)
}
</script>

<template>
    <span
        v-if="compacta && resumen"
        class="text-xs text-muted"
        data-prueba="cumplimiento-compacto"
    >{{ resumen }}</span>

    <div
        v-else-if="!compacta && regla"
        class="flex flex-col gap-2"
        data-prueba="cumplimiento"
        :data-regla-cumplimiento="promesa.regla_cumplimiento"
    >
        <div class="flex flex-wrap items-center gap-2">
            <UBadge
                :label="`Cumplimiento: ${regla.etiqueta.toLowerCase()}`"
                :icon="regla.icono"
                color="neutral"
                variant="outline"
                size="sm"
                data-prueba="regla-cumplimiento"
            />
            <span class="text-xs text-muted">{{ regla.descripcion }}</span>
        </div>
        <ul
            v-if="facturas.length"
            class="flex flex-col gap-1"
            aria-label="Facturas que cubre la promesa"
            data-prueba="facturas-promesa"
        >
            <li
                v-for="factura in facturas"
                :key="factura.factura_id"
                class="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs"
                :data-factura="factura.factura_id"
            >
                <span class="flex items-center gap-1.5 text-default">
                    <UIcon
                        :name="saldada(factura) ? 'i-lucide-circle-check' : 'i-lucide-circle-dashed'"
                        :class="['size-3.5 shrink-0', saldada(factura) ? 'text-success' : 'text-muted']"
                    />
                    {{ etiquetaFacturaCubierta(factura) }} · #{{ factura.factura_id }}
                </span>
                <span class="tabular-nums text-muted">
                    cubría {{ formatearQuetzales(factura.monto) }} · {{ saldada(factura) ? 'saldada' : `saldo hoy ${formatearQuetzales(factura.saldo)}` }}
                </span>
            </li>
        </ul>
    </div>
</template>
