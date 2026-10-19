<script setup lang="ts">
/** Mis canjes: qué premio, cuándo, cuántos puntos y en qué quedó. */
const { items, cargando, cargado, problema, hayMas, recargar, cargarMas } = useCanjes()

onMounted(recargar)
defineExpose({ recargar })
</script>

<template>
    <CuentaEstadoLista
        :cargando="cargando"
        :cargado="cargado"
        :problema="problema"
        :vacia="items.length === 0"
        :hay-mas="hayMas"
        texto-vacio="Todavía no has canjeado premios"
        icono-vacio="i-lucide-gift"
        @reintentar="recargar"
        @cargar-mas="cargarMas"
    >
        <UCard
            v-for="canje in items"
            :key="canje.id"
            :ui="{ body: 'p-4 sm:p-4' }"
            data-testid="canje"
        >
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <p class="font-medium text-highlighted">
                        {{ canje.premio_nombre }}
                    </p>
                    <p class="text-xs text-muted">
                        {{ formatearFecha(canje.created_at) }} · {{ puntosEnTexto(canje.puntos) }}<template v-if="canje.descuento">
                            · {{ formatearQuetzales(canje.descuento) }} de descuento
                        </template>
                    </p>
                </div>
                <UBadge
                    :label="ESTADOS_CANJE[canje.estado].etiqueta"
                    :color="ESTADOS_CANJE[canje.estado].color"
                    :icon="ESTADOS_CANJE[canje.estado].icono"
                    variant="subtle"
                    class="shrink-0"
                />
            </div>
        </UCard>
    </CuentaEstadoLista>
</template>
