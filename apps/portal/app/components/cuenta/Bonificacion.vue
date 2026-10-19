<script setup lang="ts">
/**
 * Un periodo bonificado (decisión del PM: nunca una factura de Q0): «Mes bonificado: <concepto>»,
 * el periodo y por qué no se paga. Sin monto a pagar, sin PDF ni XML: no hay documento.
 */
const props = withDefaults(defineProps<{
    bonificacion: BonificacionPortal
    /** compacta: una línea dentro del estado de cuenta del inicio */
    compacta?: boolean
}>(), {
    compacta: false,
})
</script>

<template>
    <div
        v-if="props.compacta"
        class="flex items-center gap-2 text-sm"
        data-testid="bonificacion"
    >
        <UIcon
            name="i-lucide-gift"
            class="size-4 shrink-0 text-success"
        />
        <span class="min-w-0 truncate text-default">{{ textoBonificacion(props.bonificacion) }}</span>
        <span class="ms-auto shrink-0 text-xs text-muted">{{ formatearPeriodo(props.bonificacion.periodo) }}</span>
    </div>
    <UCard
        v-else
        :ui="{ body: 'p-4 sm:p-4' }"
        data-testid="bonificacion"
    >
        <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
                <p class="font-medium text-highlighted">
                    {{ textoBonificacion(props.bonificacion) }}
                </p>
                <p class="text-xs text-muted">
                    Periodo {{ formatearPeriodo(props.bonificacion.periodo) }} · sin monto a pagar
                </p>
            </div>
            <UBadge
                :label="origenBonificacion(props.bonificacion.origen)"
                icon="i-lucide-gift"
                color="success"
                variant="subtle"
                class="shrink-0"
                data-testid="origen-bonificacion"
            />
        </div>
    </UCard>
</template>
