<script setup lang="ts">
/**
 * Control de velocidad de un router en un panel lateral (menú «Acciones» de la lista de routers):
 * el mismo contenido que la pestaña «Control de velocidad» de la ficha (`RouterControlVelocidad`).
 */
defineProps<{
    router: RouterNas
}>()

const abierto = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
    actualizado: [router: RouterNas]
}>()
</script>

<template>
    <USlideover
        v-model:open="abierto"
        :title="`Velocidad · ${router.nombre}`"
        :description="hostYNas(router)"
        :ui="{ content: 'sm:max-w-xl' }"
    >
        <template #body>
            <RouterControlVelocidad
                :router="router"
                compacto
                @actualizado="emit('actualizado', $event)"
            />
        </template>
    </USlideover>
</template>
