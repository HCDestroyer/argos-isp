<script setup lang="ts">
/** Par etiqueta/valor de una ficha. Sin valor muestra `—`. */
withDefaults(defineProps<{
    etiqueta: string
    valor?: string | number | null
    mono?: boolean
}>(), {
    valor: null,
    mono: false,
})
</script>

<template>
    <div class="flex flex-col gap-0.5">
        <dt class="text-xs font-medium text-muted">
            {{ etiqueta }}
        </dt>
        <dd
            class="text-sm text-highlighted break-words"
            :class="{ 'font-mono': mono }"
        >
            <slot>{{ valor === null || valor === '' ? '—' : valor }}</slot>
        </dd>
    </div>
</template>
