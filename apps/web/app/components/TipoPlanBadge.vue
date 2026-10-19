<script setup lang="ts">
/** Etiqueta del tipo de plan (Residencial, Empresarial, Dedicado); sin tipo no se dibuja. */
const props = withDefaults(defineProps<{
    tipo?: string | null
    size?: 'sm' | 'md'
}>(), {
    tipo: null,
    size: 'md',
})

const visual = computed(() => tipoPlanVisual(props.tipo))
</script>

<template>
    <UBadge
        v-if="visual"
        :label="visual.etiqueta"
        :icon="visual.icono"
        :color="visual.color"
        variant="outline"
        :size="size"
        :data-tipo-plan="tipo"
    />
</template>
