<script setup lang="ts">
/**
 * Botón «Ayuda» de la barra superior (contrato `documentacion.md` §6): abre en otra pestaña la
 * página del manual que explica la pantalla actual. La clave sale de la ruta de Nuxt
 * (`claveAyudaDeRuta`) y el sitio de `runtimeConfig.public.docsUrl` (`NUXT_PUBLIC_DOCS_URL`).
 * En el teléfono queda solo el icono, con su `aria-label` y el tooltip del navegador (`title`).
 * No usa `UTooltip`: va en la barra de todas las pantallas y las pruebas montan cada pantalla
 * sola, sin el proveedor de tooltips de `UApp`.
 */
const route = useRoute()
const config = useRuntimeConfig()

const clave = computed(() => claveAyudaDeRuta(route.matched))
const url = computed(() => clave.value ? urlAyuda(String(config.public.docsUrl), clave.value) : null)
</script>

<template>
    <UButton
        v-if="url"
        :to="url"
        target="_blank"
        rel="noopener"
        label="Ayuda"
        icon="i-lucide-circle-help"
        color="neutral"
        variant="ghost"
        title="Ayuda de esta pantalla"
        aria-label="Ayuda de esta pantalla (se abre en otra pestaña)"
        :ui="{ label: 'hidden md:inline' }"
        data-prueba="boton-ayuda"
    />
</template>
