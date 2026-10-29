<script setup lang="ts">
/** Pagos del cliente, con los depósitos que siguen en verificación. */
const { items, cargando, cargado, problema, hayMas, recargar, cargarMas } = usePagos()

onMounted(recargar)
</script>

<template>
    <CuentaEstadoLista
        :cargando="cargando"
        :cargado="cargado"
        :problema="problema"
        :vacia="items.length === 0"
        :hay-mas="hayMas"
        texto-vacio="No tienes pagos registrados"
        icono-vacio="i-lucide-wallet"
        @reintentar="recargar"
        @cargar-mas="cargarMas"
    >
        <UCard
            v-for="pago in items"
            :key="pago.id"
            data-testid="pago"
            :ui="{ body: 'p-4 sm:p-4' }"
        >
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="font-medium text-highlighted">
                        {{ METODOS_PAGO[pago.metodo] }}
                    </p>
                    <p class="text-xs text-muted">
                        {{ formatearFechaHora(pago.created_at) }}<template v-if="pago.referencia">
                            · Ref. {{ pago.referencia }}
                        </template>
                    </p>
                </div>
                <UBadge
                    :label="ESTADOS_PAGO[pago.estado].etiqueta"
                    :color="ESTADOS_PAGO[pago.estado].color"
                    :icon="ESTADOS_PAGO[pago.estado].icono"
                    variant="subtle"
                    class="shrink-0"
                />
            </div>
            <div class="mt-3 flex items-end justify-between gap-3">
                <p class="text-xs text-muted">
                    <template v-if="pago.aplicaciones.length > 0">
                        Abonado a {{ pago.aplicaciones.length === 1 ? 'la factura' : 'las facturas' }}
                        {{ pago.aplicaciones.map(a => a.factura_id).join(', ') }}
                    </template>
                    <template v-else-if="pago.estado === 'pendiente_verificacion'">
                        Lo revisamos y lo aplicamos a tus facturas
                    </template>
                </p>
                <p class="font-semibold tabular-nums text-highlighted">
                    {{ formatearQuetzales(pago.monto) }}
                </p>
            </div>
        </UCard>
    </CuentaEstadoLista>
</template>
