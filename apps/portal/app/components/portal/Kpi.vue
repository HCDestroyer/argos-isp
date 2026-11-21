<script setup lang="ts">
/**
 * Indicador del tablero (sistema visual): pastilla de icono tintada al 10 %, etiqueta gris, el dato
 * grande con cifras tabulares y un detalle. Nada se corta con elipsis: la etiqueta hace wrap a dos
 * líneas como mucho y el dato principal, a las que necesite. Con `to` toda la tarjeta es un enlace (sube 1 px al
 * pasar el puntero).
 */
const props = withDefaults(defineProps<{
    etiqueta: string
    valor: string
    detalle?: string
    icono: string
    tono?: TonoPastilla
    to?: string
}>(), {
    detalle: undefined,
    tono: 'primary',
    to: undefined,
})

const Enlace = resolveComponent('ULink')
</script>

<template>
    <component
        :is="props.to ? Enlace : 'div'"
        :to="props.to"
        class="ax-tarjeta flex min-w-0 flex-col gap-3 p-4"
        :class="props.to ? 'ax-tocable' : ''"
        :raw="props.to ? true : undefined"
    >
        <span class="flex items-center gap-2.5">
            <PortalPastilla
                :icono="props.icono"
                :tono="props.tono"
                tamano="sm"
            />
            <span class="line-clamp-2 min-w-0 text-sm text-muted">{{ props.etiqueta }}</span>
        </span>
        <span class="min-w-0">
            <span
                class="block text-xl font-semibold tracking-[-0.02em] break-words tabular-nums text-highlighted"
                data-kpi-valor
            >{{ props.valor }}</span>
            <span
                v-if="props.detalle || $slots.detalle"
                class="mt-0.5 block text-xs text-muted"
            >
                <slot name="detalle">{{ props.detalle }}</slot>
            </span>
        </span>
    </component>
</template>
