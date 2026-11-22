<script setup lang="ts">
/**
 * Pastilla de icono (o de iniciales) del sistema visual: tinte del tono al 10–12 % y el icono en el
 * tono (`.ax-pastilla` en `main.css`). Decorativa: el texto que acompaña dice lo mismo.
 */

const props = withDefaults(defineProps<{
    icono?: string
    iniciales?: string
    tono?: TonoPastilla
    tamano?: 'sm' | 'md' | 'lg'
}>(), {
    icono: undefined,
    iniciales: undefined,
    tono: 'primary',
    tamano: 'md',
})

const clases = computed(() => ({
    sm: { caja: 'size-8 text-xs', icono: 'size-4' },
    md: { caja: 'size-10 text-sm', icono: 'size-5' },
    lg: { caja: 'size-12 text-base', icono: 'size-6' },
}[props.tamano]))
</script>

<template>
    <span
        class="ax-pastilla"
        :class="clases.caja"
        :data-tono="props.tono"
        aria-hidden="true"
    >
        <UIcon
            v-if="props.icono"
            :name="props.icono"
            :class="clases.icono"
        />
        <template v-else>{{ props.iniciales }}</template>
    </span>
</template>
