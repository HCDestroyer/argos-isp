<script setup lang="ts">
/**
 * Indicador del dashboard: etiqueta, cifra principal (número vivo: rueda al cambiar) y una línea de contexto. El color no
 * codifica nada aquí (el valor va en tinta de texto); el enlace lleva a la lista que lo explica.
 */
withDefaults(defineProps<{
    etiqueta: string
    valor: string
    detalle?: string
    icono?: string
    to?: string
    etiquetaEnlace?: string
}>(), {
    detalle: undefined,
    icono: undefined,
    to: undefined,
    etiquetaEnlace: 'Ver',
})
</script>

<template>
    <div class="flex min-w-0 flex-col gap-1 surface-card p-4">
        <div class="flex items-center justify-between gap-2">
            <span class="flex items-center gap-1.5 text-sm text-muted">
                <UIcon
                    v-if="icono"
                    :name="icono"
                    class="size-4 shrink-0"
                />
                {{ etiqueta }}
            </span>
            <UButton
                v-if="to"
                :to="to"
                :label="etiquetaEnlace"
                trailing-icon="i-lucide-chevron-right"
                color="neutral"
                variant="link"
                size="xs"
                class="-my-1 -mr-2"
            />
        </div>
        <p
            class="truncate text-2xl font-semibold tracking-[-0.02em] tabular-nums text-highlighted"
            data-prueba="valor"
        >
            <NumeroVivo :valor="valor" />
        </p>
        <p
            v-if="detalle || $slots.default"
            class="text-xs text-muted"
        >
            <slot>{{ detalle }}</slot>
        </p>
    </div>
</template>
