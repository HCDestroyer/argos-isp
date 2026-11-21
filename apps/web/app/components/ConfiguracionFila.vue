<script setup lang="ts">
/**
 * Fila de un `ConfiguracionBloque`: etiqueta (y su ayuda debajo) a la izquierda y el valor o el
 * control (interruptor, botón) a la derecha, como en los tableros OperConfig*.
 */
const props = withDefaults(defineProps<{
    etiqueta: string
    ayuda?: string
    valor?: string | number | null
    /** Etiqueta en negrita (filas con interruptor). */
    fuerte?: boolean
    mono?: boolean
}>(), {
    ayuda: undefined,
    valor: undefined,
    fuerte: false,
    mono: false,
})
</script>

<template>
    <div
        class="flex min-w-0 items-center justify-between gap-3 border-(--ax-borde) py-2.5 [&:not(:first-child)]:border-t"
        data-fila-config
    >
        <div class="flex min-w-0 flex-col">
            <span
                class="text-sm"
                :class="props.fuerte ? 'font-semibold text-highlighted' : 'text-muted'"
            >{{ props.etiqueta }}</span>
            <span
                v-if="props.ayuda"
                class="text-xs text-muted"
            >{{ props.ayuda }}</span>
        </div>
        <div class="flex min-w-0 shrink-0 items-center justify-end gap-2 text-end text-sm text-highlighted">
            <slot>
                <span :class="props.mono ? 'font-mono' : ''">{{ props.valor ?? '—' }}</span>
            </slot>
        </div>
    </div>
</template>
