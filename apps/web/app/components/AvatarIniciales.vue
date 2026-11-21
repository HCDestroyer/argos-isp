<script setup lang="ts">
import type { AvatarProps } from '@nuxt/ui'

/**
 * Avatar con las iniciales de un nombre y un tono de la paleta categórica derivado del nombre (el
 * mismo nombre, siempre el mismo color). Decorativo: el nombre va siempre en texto al lado.
 */
const props = withDefaults(defineProps<{
    nombre: string
    size?: AvatarProps['size']
}>(), {
    size: 'md',
})

const iniciales = computed(() => inicialesDe(props.nombre))
const tono = computed(() => `tono-${tonoDeTexto(props.nombre)}`)
</script>

<template>
    <UAvatar
        :text="iniciales"
        :size="size"
        :class="tono"
        class="pastilla-tono shrink-0"
        :ui="{ fallback: 'font-semibold text-(--tono-texto)' }"
        aria-hidden="true"
    />
</template>
