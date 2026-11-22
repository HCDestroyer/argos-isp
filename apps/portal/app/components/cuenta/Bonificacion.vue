<script setup lang="ts">
/**
 * Un periodo bonificado (decisión del PM: nunca una factura de Q0): «Mes bonificado: <concepto>»,
 * el periodo y por qué no se paga. Sin monto a pagar, sin PDF ni XML: no hay documento. En la
 * lista de facturas es una fila más (`PortalFila`); en el inicio, una línea compacta.
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
    <PortalFila
        v-else
        :titulo="textoBonificacion(props.bonificacion)"
        :subtitulo="`Periodo ${formatearPeriodo(props.bonificacion.periodo)} · sin monto a pagar`"
        icono="i-lucide-gift"
        tono="success"
        :estado="{ etiqueta: origenBonificacion(props.bonificacion.origen), color: 'success', icono: 'i-lucide-gift' }"
        testid-estado="origen-bonificacion"
        data-testid="bonificacion"
    />
</template>
