<script setup lang="ts">
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { es } from '@nuxt/ui/locale'

/** Al cambiar de empresa la página se vuelve a montar y relee sus datos (sin perder la sesión). */
const { eleccion } = useEmpresaActiva()
const clavePagina = (ruta: RouteLocationNormalizedLoaded) => `${ruta.path}|${String(eleccion.value)}`
</script>

<template>
    <UApp :locale="es">
        <NuxtLayout>
            <NuxtPage :page-key="clavePagina" />
        </NuxtLayout>
    </UApp>
</template>
