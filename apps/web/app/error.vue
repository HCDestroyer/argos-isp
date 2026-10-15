<script setup lang="ts">
import type { NuxtError } from '#app'
import { es } from '@nuxt/ui/locale'

const props = defineProps<{
    error: NuxtError
}>()

const titulo = computed(() => {
    if (props.error.statusCode === 403) {
        return 'Sin permiso'
    }
    if (props.error.statusCode === 404) {
        return 'Página no encontrada'
    }
    return 'Algo salió mal'
})
</script>

<template>
    <UApp :locale="es">
        <UError
            :error="{
                statusCode: error.statusCode,
                statusMessage: titulo,
                message: error.statusCode === 404 ? 'La dirección que buscas no existe.' : error.message,
            }"
            :clear="{ label: 'Volver al inicio', color: 'primary' }"
            redirect="/"
        />
    </UApp>
</template>
