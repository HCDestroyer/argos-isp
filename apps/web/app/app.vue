<script setup lang="ts">
import type { RouteLocationNormalizedLoaded } from 'vue-router'
import { es } from '@nuxt/ui/locale'

/**
 * Al cambiar de empresa la página se vuelve a montar y relee sus datos (sin perder la sesión).
 * Las páginas públicas (login) van solo por ruta: al salir, la elección pasa a `null` mientras
 * el login se monta y cambiarle la clave a media carga lo volvía a montar dentro de su propio
 * render (error en `UColorModeButton`, y el panel de errores de Nuxt dev quedaba abierto).
 */
const { eleccion } = useEmpresaActiva()
const clavePagina = (ruta: RouteLocationNormalizedLoaded) => (ruta.meta.publica ? ruta.path : `${ruta.path}|${String(eleccion.value)}`)
</script>

<template>
    <UApp :locale="es">
        <NuxtLayout>
            <NuxtPage :page-key="clavePagina" />
        </NuxtLayout>
    </UApp>
</template>
