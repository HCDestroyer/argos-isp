<script setup lang="ts">
/**
 * Barra de ocupación de una red o un pool (tableros RedRouters y RedIps): el color avisa cuando se
 * llena (índigo hasta 85 %, ámbar desde 85 % y rojo desde 95 %) y el porcentaje va también en
 * texto, nunca solo en color.
 */
const props = withDefaults(defineProps<{
    porcentaje: number
    /** Texto a la derecha («222 libres»). */
    detalle?: string
    /** Sin el porcentaje grande encima (lista compacta). */
    soloBarra?: boolean
}>(), {
    detalle: undefined,
    soloBarra: false,
})

const color = computed(() => (props.porcentaje >= 95 ? 'error' : props.porcentaje >= 85 ? 'warning' : 'primary'))
const redondeado = computed(() => Math.round(props.porcentaje))
</script>

<template>
    <div class="flex min-w-0 flex-col gap-1">
        <div
            v-if="!soloBarra"
            class="flex items-baseline justify-between gap-2"
        >
            <span class="text-sm font-semibold text-highlighted tabular-nums">{{ redondeado }} %</span>
            <span
                v-if="detalle"
                class="truncate text-xs text-muted"
            >{{ detalle }}</span>
        </div>
        <UProgress
            :model-value="Math.min(100, Math.max(0, porcentaje))"
            :color="color"
            size="sm"
            :aria-label="`${redondeado} % ocupado`"
        />
    </div>
</template>
