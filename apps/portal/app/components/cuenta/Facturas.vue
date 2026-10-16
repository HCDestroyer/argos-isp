<script setup lang="ts">
/** Facturas (avisos de cobro) del cliente: concepto, estado, total, saldo y vencimiento. */
const { items, cargando, cargado, problema, hayMas, recargar, cargarMas } = useFacturas()

onMounted(recargar)
</script>

<template>
    <CuentaEstadoLista
        :cargando="cargando"
        :cargado="cargado"
        :problema="problema"
        :vacia="items.length === 0"
        :hay-mas="hayMas"
        texto-vacio="Todavía no tienes facturas"
        icono-vacio="i-lucide-receipt"
        @reintentar="recargar"
        @cargar-mas="cargarMas"
    >
        <UCard
            v-for="factura in items"
            :key="factura.id"
            data-testid="factura"
            :ui="{ body: 'p-4 sm:p-4' }"
        >
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="font-medium text-highlighted">
                        {{ conceptoFactura(factura) }}
                    </p>
                    <p class="text-xs text-muted">
                        {{ nombreDocumento(factura) }} · vence {{ formatearFecha(factura.vence_en) }}
                    </p>
                </div>
                <UBadge
                    :label="ESTADOS_FACTURA[factura.estado].etiqueta"
                    :color="ESTADOS_FACTURA[factura.estado].color"
                    variant="subtle"
                    class="shrink-0"
                />
            </div>

            <div class="mt-3 flex items-end justify-between gap-3">
                <div>
                    <p class="text-xs text-muted">
                        Total
                    </p>
                    <p class="tabular-nums text-default">
                        {{ formatearQuetzales(factura.total) }}
                    </p>
                </div>
                <div
                    v-if="factura.estado !== 'anulada' && factura.estado !== 'pagada'"
                    class="text-right"
                >
                    <p class="text-xs text-muted">
                        Saldo
                    </p>
                    <p class="font-semibold tabular-nums text-highlighted">
                        {{ formatearQuetzales(factura.saldo) }}
                    </p>
                </div>
            </div>
        </UCard>
    </CuentaEstadoLista>
</template>
