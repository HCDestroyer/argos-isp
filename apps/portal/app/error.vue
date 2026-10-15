<script setup lang="ts">
import type { NuxtError } from '#app'
import { es } from '@nuxt/ui/locale'

const props = defineProps<{
    error: NuxtError
}>()

const titulo = computed(() => props.error.statusCode === 404 ? 'Página no encontrada' : 'Algo salió mal')
</script>

<template>
    <UApp :locale="es">
        <UError
            :error="{
                statusCode: error.statusCode,
                statusMessage: titulo,
                message: error.statusCode === 404 ? 'La dirección que buscas no existe.' : 'Intenta de nuevo en unos minutos.',
            }"
            :clear="{ label: 'Ver el estado de mi servicio', color: 'primary' }"
            redirect="/corte"
        />
    </UApp>
</template>
