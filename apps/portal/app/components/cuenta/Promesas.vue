<script setup lang="ts">
/** Promesas de pago del cliente (solo lectura; se solicitan desde la página de corte). */
const { items, cargando, cargado, problema, hayMas, recargar, cargarMas } = usePromesas()

onMounted(recargar)
</script>

<template>
    <CuentaEstadoLista
        :cargando="cargando"
        :cargado="cargado"
        :problema="problema"
        :vacia="items.length === 0"
        :hay-mas="hayMas"
        texto-vacio="No tienes promesas de pago"
        icono-vacio="i-lucide-hand-coins"
        @reintentar="recargar"
        @cargar-mas="cargarMas"
    >
        <UCard
            v-for="promesa in items"
            :key="promesa.id"
            data-testid="promesa"
            :ui="{ body: 'p-4 sm:p-4' }"
        >
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="font-medium text-highlighted">
                        Pagar {{ formatearQuetzales(promesa.monto) }}
                    </p>
                    <p class="text-xs text-muted">
                        A más tardar el {{ formatearFechaHora(promesa.vence_en) }}
                    </p>
                </div>
                <UBadge
                    :label="ESTADOS_PROMESA[promesa.estado].etiqueta"
                    :color="ESTADOS_PROMESA[promesa.estado].color"
                    variant="subtle"
                    class="shrink-0"
                />
            </div>
        </UCard>
    </CuentaEstadoLista>
</template>
