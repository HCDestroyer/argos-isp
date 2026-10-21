<script setup lang="ts">
/**
 * Imagen de un premio del sorteo. Solo del mismo origen (`imagenDelPortal`): una URL externa, o una
 * que no carga, deja el ícono del premio en su lugar con el mismo tamaño (la página no salta).
 */
const props = defineProps<{
    url: string | null
    nombre: string
}>()

const src = computed(() => imagenDelPortal(props.url))
const fallo = ref(false)
watch(src, () => {
    fallo.value = false
})
</script>

<template>
    <img
        v-if="src && !fallo"
        :src="src"
        :alt="props.nombre"
        width="320"
        height="240"
        loading="lazy"
        decoding="async"
        class="aspect-4/3 w-full rounded-lg bg-elevated object-cover"
        data-testid="imagen-premio"
        @error="fallo = true"
    >
    <div
        v-else
        class="flex aspect-4/3 w-full items-center justify-center rounded-lg bg-primary/10 text-primary"
        aria-hidden="true"
        data-testid="imagen-premio-vacia"
    >
        <UIcon
            name="i-lucide-gift"
            class="size-10"
        />
    </div>
</template>
